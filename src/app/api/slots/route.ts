import { NextRequest, NextResponse } from "next/server";
import db, { EventType, Host } from "@/lib/db";
import { computeSlots } from "@/lib/slots";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const eventTypeId = Number(sp.get("eventTypeId"));
  const from = sp.get("from");
  const to = sp.get("to");
  if (!eventTypeId || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ? AND active = 1")
    .get(eventTypeId) as EventType | undefined;
  if (!eventType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const host = db
    .prepare("SELECT * FROM hosts WHERE id = ?")
    .get(eventType.host_id) as Host;
  // Rescheduling: exclude the booking being moved (authorized by its secret
  // cancel token) so it doesn't block its own new time.
  let excludeBookingId: number | undefined;
  const exclude = sp.get("exclude");
  if (exclude) {
    const own = db
      .prepare(
        "SELECT id FROM bookings WHERE cancel_token = ? AND host_id = ? AND status = 'confirmed'"
      )
      .get(exclude, host.id) as { id: number } | undefined;
    excludeBookingId = own?.id;
  }
  const slots = await computeSlots(host, eventType, from, to, { excludeBookingId });
  return NextResponse.json({ slots });
}
