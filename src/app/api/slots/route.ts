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
  const slots = await computeSlots(host, eventType, from, to);
  return NextResponse.json({ slots });
}
