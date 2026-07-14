import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import db, { Booking, EventType, Host } from "@/lib/db";
import { sendBookingEmails } from "@/lib/email";

/**
 * Re-send confirmation emails (with current invite format) for all of the
 * authenticated host's confirmed, upcoming bookings. Useful after email
 * format changes. Auth: Bearer <api_token>.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const host = token
    ? (db.prepare("SELECT * FROM hosts WHERE api_token = ?").get(token) as Host | undefined)
    : undefined;
  if (!host) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const bookings = db
    .prepare(
      "SELECT * FROM bookings WHERE host_id = ? AND status = 'confirmed' AND start_utc > ? ORDER BY start_utc"
    )
    .all(host.id, DateTime.utc().toISO()) as Booking[];

  const resent: number[] = [];
  for (const booking of bookings) {
    const eventType = db
      .prepare("SELECT * FROM event_types WHERE id = ?")
      .get(booking.event_type_id) as EventType;
    await sendBookingEmails(booking, host, eventType, "confirmed");
    resent.push(booking.id);
  }
  return NextResponse.json({ ok: true, resent });
}
