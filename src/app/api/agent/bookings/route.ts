import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import db, { Booking, Host } from "@/lib/db";

/**
 * Bookings feed for the local calendar agent (Mac EventKit agent): upcoming
 * and recently-ended bookings, including cancelled ones so the agent can
 * remove their calendar events. Same bearer-token auth as /api/busy.
 *
 * This is how bookings reach the host's calendar when email invites can't
 * (corporate Exchange transport rules strip the inline text/calendar part).
 */

interface AgentBooking {
  id: number;
  summary: string;
  start: string;
  end: string;
  status: string;
  guestName: string;
  guestEmail: string;
  notes: string;
  location: string;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const host = db
    .prepare("SELECT * FROM hosts WHERE api_token = ?")
    .get(token) as Host | undefined;
  if (!host) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const from = DateTime.utc().minus({ days: 2 }).toISO()!;
  const rows = db
    .prepare(
      `SELECT b.*, et.name AS event_type_name
       FROM bookings b
       JOIN event_types et ON et.id = b.event_type_id
       WHERE b.host_id = ? AND b.end_utc >= ?
       ORDER BY b.start_utc`
    )
    .all(host.id, from) as (Booking & { event_type_name: string })[];

  const bookings: AgentBooking[] = rows.map((b) => ({
    id: b.id,
    // Same convention as the notification email: lead with who's coming.
    summary: b.guest_company
      ? `${b.guest_company} - ${b.guest_name}`
      : `${b.event_type_name} - ${b.guest_name}`,
    start: b.start_utc,
    end: b.end_utc,
    status: b.status,
    guestName: b.guest_name,
    guestEmail: b.guest_email,
    notes: b.notes || "",
    location: b.webex_link || "",
  }));

  return NextResponse.json({ bookings });
}
