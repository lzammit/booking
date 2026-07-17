import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import db, { Booking, Host } from "@/lib/db";

/**
 * The host's bookings published as an ICS calendar. Hosts subscribe to this
 * URL from their calendar app (Outlook "Add calendar → Subscribe from web",
 * Apple Calendar "New Calendar Subscription", Google "From URL") and their
 * bookings appear there — no install, and it works even where corporate
 * Exchange mangles invite emails. Cancelled bookings simply drop out of the
 * feed, so the calendar app removes them on its next refresh.
 *
 * Auth is the secret feed token in the URL (calendar apps can't send
 * headers) — same trust model as Google Calendar's secret iCal address.
 */

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function icsEscape(s: string): string {
  return s
    .replace(/\r/g, "") // bare CR could smuggle new ICS lines past \n escaping
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const raw = token.endsWith(".ics") ? token.slice(0, -4) : token;
  const host = db
    .prepare("SELECT * FROM hosts WHERE feed_token = ?")
    .get(raw) as Host | undefined;
  if (!host || !raw) {
    return new NextResponse("Not found", { status: 404 });
  }

  const from = DateTime.utc().minus({ days: 30 }).toISO()!;
  const rows = db
    .prepare(
      `SELECT b.*, et.name AS event_type_name
       FROM bookings b
       JOIN event_types et ON et.id = b.event_type_id
       WHERE b.host_id = ? AND b.status = 'confirmed' AND b.end_utc >= ?
       ORDER BY b.start_utc`
    )
    .all(host.id, from) as (Booking & { event_type_name: string })[];

  const fmt = (iso: string) =>
    DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyyMMdd'T'HHmmss'Z'");
  const stamp = fmt(DateTime.utc().toISO()!);
  const uidHost = new URL(APP_URL).hostname;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booking//feed//EN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Bookings — ${host.name}`)}`,
    "X-PUBLISHED-TTL:PT30M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
  ];
  for (const b of rows) {
    const summary = b.guest_company
      ? `${b.guest_company} - ${b.guest_name}`
      : `${b.event_type_name} - ${b.guest_name}`;
    const description =
      `${b.guest_name} <${b.guest_email}>` +
      (b.notes ? `\n${b.notes}` : "") +
      (b.webex_link ? `\nJoin Webex: ${b.webex_link}` : "") +
      `\nCancel: ${APP_URL}/cancel/${b.cancel_token}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:booking-${b.id}@${uidHost}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${fmt(b.start_utc)}`,
      `DTEND:${fmt(b.end_utc)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      ...(b.webex_link ? [`LOCATION:${icsEscape(b.webex_link)}`, `URL:${b.webex_link}`] : []),
      "STATUS:CONFIRMED",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
