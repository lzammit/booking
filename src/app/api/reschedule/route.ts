import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db, { Booking, EventType, Host } from "@/lib/db";
import { isSlotFree } from "@/lib/slots";
import { getSession } from "@/lib/session";
import { sendBookingEmails } from "@/lib/email";
import { updateOutlookEvent } from "@/lib/msgraph";
import { updateWebexMeeting } from "@/lib/webex";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/**
 * Move a confirmed booking to a new time. Authorized by the booking's secret
 * cancel token (the same link guests get in their email; the host dashboard
 * links to it too). The booking keeps its id and calendar UID; its iCalendar
 * SEQUENCE is bumped so calendar clients move the existing event.
 */

const rescheduleSchema = z.object({
  token: z.string().min(16).max(100),
  start: z.string(),
  timezone: z.string().max(60).optional(),
  locale: z.enum(["en", "fr"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(`resched:${clientIp(req.headers)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts — please try again in a few minutes.", code: "rate_limited" },
      { status: 429 }
    );
  }

  let input;
  try {
    input = rescheduleSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const booking = db
    .prepare("SELECT * FROM bookings WHERE cancel_token = ? AND status = 'confirmed'")
    .get(input.token) as Booking | undefined;
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(booking.event_type_id) as EventType;
  const host = db
    .prepare("SELECT * FROM hosts WHERE id = ?")
    .get(booking.host_id) as Host;

  const start = DateTime.fromISO(input.start, { zone: "utc" });
  if (!start.isValid) {
    return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
  }
  const startIso = start.toISO()!;
  const endIso = start.plus({ minutes: eventType.duration_min }).toISO()!;

  if (startIso !== booking.start_utc) {
    const free = await isSlotFree(host, eventType, startIso, {
      excludeBookingId: booking.id,
    });
    if (!free) {
      return NextResponse.json(
        {
          error: "That time is no longer available. Please pick another slot.",
          code: "slot_taken",
        },
        { status: 409 }
      );
    }
  }

  // The timezone/locale in the payload describe whoever drove the widget.
  // When that's the HOST (rescheduling from their dashboard), they must NOT
  // replace the guest's stored values — that bug stamped hosts' zones onto
  // foreign clients, whose emails then showed times they misread.
  const session = await getSession();
  const hostDriven = session.hostId === booking.host_id;
  let tzOk = (hostDriven ? booking.guest_timezone : input.timezone) ?? booking.guest_timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tzOk });
  } catch {
    tzOk = booking.guest_timezone;
  }
  const localeOk = hostDriven ? booking.guest_locale : (input.locale ?? booking.guest_locale);
  const previousStartUtc = booking.start_utc;

  db.prepare(
    `UPDATE bookings SET start_utc = ?, end_utc = ?, sequence = sequence + 1,
       reminder_sent = 0, guest_timezone = ?, guest_locale = ? WHERE id = ?`
  ).run(startIso, endIso, tzOk, localeOk, booking.id);
  const updated = db
    .prepare("SELECT * FROM bookings WHERE id = ?")
    .get(booking.id) as Booking;

  // Best-effort side effects; the reschedule stands even if these fail.
  if (updated.webex_meeting_id) {
    await updateWebexMeeting({
      hostId: host.id,
      meetingId: updated.webex_meeting_id,
      title: `${eventType.name} — ${host.name} / ${updated.guest_name}`,
      startUtc: startIso,
      endUtc: endIso,
    });
  }
  if (updated.ms_event_id) {
    await updateOutlookEvent(host.id, updated.ms_event_id, startIso, endIso);
  }
  await sendBookingEmails(updated, host, eventType, "rescheduled", { previousStartUtc });

  return NextResponse.json({ ok: true, start: startIso });
}
