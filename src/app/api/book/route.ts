import { randomBytes } from "crypto";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db, { Booking, EventType, Host } from "@/lib/db";
import { isSlotFree } from "@/lib/slots";
import { sendBookingEmails } from "@/lib/email";
import { createOutlookEvent } from "@/lib/msgraph";

const bookSchema = z.object({
  eventTypeId: z.number().int(),
  start: z.string(),
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  notes: z.string().max(2000).default(""),
  timezone: z.string().max(60).default("UTC"),
});

export async function POST(req: NextRequest) {
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
      { error: "That time is no longer available. Please pick another slot." },
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
      `INSERT INTO bookings (host_id, event_type_id, guest_name, guest_email, guest_timezone, notes, start_utc, end_utc, cancel_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      host.id,
      eventType.id,
      input.name,
      input.email,
      tzOk,
      input.notes,
      startIso,
      endIso,
      cancelToken
    );
  const booking = db
    .prepare("SELECT * FROM bookings WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as Booking;

  // Best-effort side effects; the booking stands even if these fail.
  const msEventId = await createOutlookEvent({
    hostId: host.id,
    subject: `${eventType.name} — ${input.name}`,
    body: `${input.notes ? input.notes + "\n\n" : ""}Booked via ${process.env.APP_URL || "booking app"}. Guest: ${input.name} <${input.email}>`,
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
