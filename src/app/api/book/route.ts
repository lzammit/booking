import { randomBytes } from "crypto";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db, { Booking, EventType, Host } from "@/lib/db";
import { isSlotFree } from "@/lib/slots";
import { sendBookingEmails } from "@/lib/email";
import { createOutlookEvent } from "@/lib/msgraph";
import { createWebexMeeting } from "@/lib/webex";
import { cleanText, clientIp, rateLimit } from "@/lib/ratelimit";

const bookSchema = z.object({
  eventTypeId: z.number().int(),
  start: z.string(),
  name: z.string().min(1).max(120).transform(cleanText).refine((s) => s.length > 0),
  company: z.string().min(1).max(120).transform(cleanText).refine((s) => s.length > 0),
  email: z.string().email().max(200),
  notes: z.string().max(2000).transform(cleanText).default(""),
  timezone: z.string().max(60).default("UTC"),
  locale: z.enum(["en", "fr"]).default("en"),
});

export async function POST(req: NextRequest) {
  // Bookings send email and consume the host's availability — throttle per IP.
  if (!rateLimit(`book:${clientIp(req.headers)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      {
        error: "Too many booking attempts — please try again in a few minutes.",
        code: "rate_limited",
      },
      { status: 429 }
    );
  }

  let input;
  try {
    input = bookSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid booking data" }, { status: 400 });
  }

  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ? AND active = 1")
    .get(input.eventTypeId) as EventType | undefined;
  if (!eventType) {
    return NextResponse.json({ error: "Event type not found" }, { status: 404 });
  }
  const host = db
    .prepare("SELECT * FROM hosts WHERE id = ?")
    .get(eventType.host_id) as Host;

  const start = DateTime.fromISO(input.start, { zone: "utc" });
  if (!start.isValid) {
    return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
  }
  const startIso = start.toISO()!;
  const endIso = start.plus({ minutes: eventType.duration_min }).toISO()!;

  if (!(await isSlotFree(host, eventType, startIso))) {
    return NextResponse.json(
      {
        error: "That time is no longer available. Please pick another slot.",
        code: "slot_taken",
      },
      { status: 409 }
    );
  }

  let tzOk = input.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tzOk });
  } catch {
    tzOk = "UTC";
  }

  const cancelToken = randomBytes(24).toString("hex");
  const res = db
    .prepare(
      `INSERT INTO bookings (host_id, event_type_id, guest_name, guest_email, guest_company, guest_timezone, guest_locale, notes, start_utc, end_utc, cancel_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      host.id,
      eventType.id,
      input.name,
      input.email,
      input.company,
      tzOk,
      input.locale,
      input.notes,
      startIso,
      endIso,
      cancelToken
    );
  let booking = db
    .prepare("SELECT * FROM bookings WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as Booking;

  // Best-effort side effects; the booking stands even if these fail.
  // Create the Webex meeting first so its link can ride along in the emails.
  const webex = await createWebexMeeting({
    hostId: host.id,
    title: `${eventType.name} — ${host.name} / ${input.name}`,
    agenda: `${input.notes ? input.notes + "\n\n" : ""}Guest: ${input.name} (${input.company}) <${input.email}>`,
    startUtc: startIso,
    endUtc: endIso,
    guestEmail: input.email,
  });
  if (webex) {
    db.prepare(
      "UPDATE bookings SET webex_link = ?, webex_meeting_id = ? WHERE id = ?"
    ).run(webex.link, webex.meetingId, booking.id);
    booking = { ...booking, webex_link: webex.link, webex_meeting_id: webex.meetingId };
  } else if (eventType.meeting_url) {
    // No dynamic meeting (Webex not connected) — fall back to the event
    // type's static meeting link. No meeting_id: there's nothing to cancel.
    db.prepare("UPDATE bookings SET webex_link = ? WHERE id = ?").run(
      eventType.meeting_url,
      booking.id
    );
    booking = { ...booking, webex_link: eventType.meeting_url };
  }

  const msEventId = await createOutlookEvent({
    hostId: host.id,
    subject: `${input.company} - ${input.name}`,
    body: `${input.notes ? input.notes + "\n\n" : ""}${booking.webex_link ? `Join Webex: ${booking.webex_link}\n\n` : ""}Booked via ${process.env.APP_URL || "booking app"}. Guest: ${input.name} (${input.company}) <${input.email}>`,
    startUtc: startIso,
    endUtc: endIso,
    guestName: input.name,
    guestEmail: input.email,
  });
  if (msEventId) {
    db.prepare("UPDATE bookings SET ms_event_id = ? WHERE id = ?").run(msEventId, booking.id);
  }
  await sendBookingEmails(booking, host, eventType, "confirmed");

  return NextResponse.json({ ok: true, bookingId: booking.id });
}
