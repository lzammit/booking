import nodemailer from "nodemailer";
import { DateTime } from "luxon";
import { Booking, EventType, Host } from "./db";

/**
 * SMTP email with .ics attachments. Optional: if SMTP_HOST is unset,
 * sending is skipped (booking still succeeds).
 */

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function transport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildIcs(
  booking: Booking,
  host: Host,
  eventType: EventType,
  method: "REQUEST" | "CANCEL",
  summary: string
): string {
  const fmt = (iso: string) =>
    DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyyMMdd'T'HHmmss'Z'");
  const cancelUrl = `${APP_URL}/cancel/${booking.cancel_token}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booking//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:booking-${booking.id}@${new URL(APP_URL).hostname}`,
    `DTSTAMP:${fmt(DateTime.utc().toISO()!)}`,
    `DTSTART:${fmt(booking.start_utc)}`,
    `DTEND:${fmt(booking.end_utc)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(`${booking.notes ? booking.notes + "\n\n" : ""}Cancel: ${cancelUrl}`)}`,
    `ORGANIZER;CN=${icsEscape(host.name)}:mailto:${host.email}`,
    `ATTENDEE;CN=${icsEscape(booking.guest_name)};RSVP=TRUE:mailto:${booking.guest_email}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    ...(method === "CANCEL" ? ["SEQUENCE:1"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export async function sendBookingEmails(
  booking: Booking,
  host: Host,
  eventType: EventType,
  kind: "confirmed" | "cancelled"
) {
  const t = transport();
  if (!t) {
    console.log(`SMTP not configured; skipping ${kind} emails for booking ${booking.id}`);
    return;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const startGuest = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(booking.guest_timezone)
    .toFormat("cccc, LLLL d yyyy 'at' h:mm a (ZZZZ)");
  const startHost = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(host.timezone)
    .toFormat("cccc, LLLL d yyyy 'at' h:mm a (ZZZZ)");
  const cancelUrl = `${APP_URL}/cancel/${booking.cancel_token}`;
  const method = kind === "confirmed" ? "REQUEST" : "CANCEL";
  // The host's invite (and email subject) leads with who's coming:
  // "<Company> - <Guest name>". The guest's invite leads with the meeting.
  const hostSummary = booking.guest_company
    ? `${booking.guest_company} - ${booking.guest_name}`
    : `${eventType.name} - ${booking.guest_name}`;
  const icsFor = (summary: string) => ({
    filename: kind === "confirmed" ? "invite.ics" : "cancel.ics",
    content: buildIcs(booking, host, eventType, method, summary),
    contentType: `text/calendar; method=${method}`,
  });

  const subjectBase = `${eventType.name} with ${host.name}`;
  const results = await Promise.allSettled([
    t.sendMail({
      from,
      to: booking.guest_email,
      subject:
        kind === "confirmed"
          ? `Confirmed: ${subjectBase} — ${startGuest}`
          : `Cancelled: ${subjectBase}`,
      text:
        kind === "confirmed"
          ? `Hi ${booking.guest_name},\n\nYour booking is confirmed.\n\nWhat: ${subjectBase} (${eventType.duration_min} min)\nWhen: ${startGuest}\n\nNeed to cancel? ${cancelUrl}\n`
          : `Hi ${booking.guest_name},\n\nThis booking has been cancelled.\n\nWhat: ${subjectBase}\nWhen: ${startGuest}\n`,
      attachments: [icsFor(`${subjectBase}`)],
    }),
    t.sendMail({
      from,
      to: host.email,
      subject: kind === "confirmed" ? hostSummary : `Cancelled: ${hostSummary}`,
      text:
        kind === "confirmed"
          ? `${booking.guest_name} (${booking.guest_company || "no company given"}) <${booking.guest_email}> booked "${eventType.name}".\n\nWhen: ${startHost}\nNotes: ${booking.notes || "(none)"}\n`
          : `${booking.guest_name} (${booking.guest_company || "no company given"}) <${booking.guest_email}> — booking "${eventType.name}" on ${startHost} was cancelled.\n`,
      attachments: [icsFor(hostSummary)],
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("Email send failed:", r.reason);
  }
}
