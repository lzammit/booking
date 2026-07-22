import nodemailer from "nodemailer";
import { DateTime } from "luxon";
import { Booking, EventType, Host } from "./db";
import { Locale, LOCALES, t as tr } from "./i18n";

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
  return s
    .replace(/\r/g, "") // bare CR could smuggle new ICS lines past \n escaping
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

interface IcsParty {
  name: string;
  email: string;
}

function buildIcs(
  booking: Booking,
  method: "REQUEST" | "CANCEL",
  summary: string,
  organizer: IcsParty,
  attendee: IcsParty
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
    `DESCRIPTION:${icsEscape(
      `${booking.notes ? booking.notes + "\n\n" : ""}${booking.webex_link ? `Join Webex: ${booking.webex_link}\n\n` : ""}Cancel: ${cancelUrl}`
    )}`,
    ...(booking.webex_link ? [`LOCATION:${icsEscape(booking.webex_link)}`, `URL:${booking.webex_link}`] : []),
    `ORGANIZER;CN=${icsEscape(organizer.name)}:mailto:${organizer.email}`,
    `ATTENDEE;CN=${icsEscape(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`,
    "TRANSP:OPAQUE",
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    // Same UID + higher SEQUENCE = calendar clients move the existing event.
    `SEQUENCE:${method === "CANCEL" ? booking.sequence + 1 : booking.sequence}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** Heads-up email when a user is granted admin rights. Best effort. */
export async function sendAdminPromotionEmail(
  to: string,
  name: string,
  promotedBy: string
) {
  const t = transport();
  if (!t) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  try {
    await t.sendMail({
      from,
      to,
      subject: "You're now an admin on Booking",
      text: `Hi ${name},\n\n${promotedBy} made you an administrator on ${APP_URL}.\n\nYou can now manage users and invitations from the Admin page: ${APP_URL}/dashboard/admin\n`,
    });
  } catch (err) {
    console.error("Admin promotion email failed:", err);
  }
}

/** Invitation to create a host account. Returns false when sending failed. */
export async function sendInviteEmail(
  to: string,
  inviterName: string,
  signupUrl: string
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  try {
    await t.sendMail({
      from,
      to,
      subject: `${inviterName} invited you to Booking`,
      text: `${inviterName} invited you to create a booking page.\n\nPeople will be able to pick meeting times that fit your calendar.\n\nCreate your account: ${signupUrl}\n`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333;">
<p>${inviterName} invited you to create a booking page — a link people use to pick meeting times that fit your calendar.</p>
<p style="margin: 20px 0;"><a href="${signupUrl}" style="display: inline-block; background-color: #1C2333; color: #FBFAF7; text-decoration: none; font-weight: bold; padding: 10px 18px; border-radius: 8px;">Create your account</a></p>
<p style="color: #6b7280; font-size: 12px;">Or open: <a href="${signupUrl}" style="color: #0563C1;">${signupUrl}</a></p>
</div>`,
    });
    return true;
  } catch (err) {
    console.error("Invite email failed:", err);
    return false;
  }
}

export async function sendBookingEmails(
  booking: Booking,
  host: Host,
  eventType: EventType,
  kind: "confirmed" | "cancelled" | "rescheduled"
) {
  const t = transport();
  if (!t) {
    console.log(`SMTP not configured; skipping ${kind} emails for booking ${booking.id}`);
    return;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  // The guest's copy speaks their language (stored at booking time).
  const guestLocale: Locale = LOCALES.includes(booking.guest_locale as Locale)
    ? (booking.guest_locale as Locale)
    : "en";
  const startGuest = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(booking.guest_timezone)
    .setLocale(guestLocale)
    .toLocaleString({
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  const startHost = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(host.timezone)
    .toFormat("cccc, LLLL d yyyy 'at' h:mm a (ZZZZ)");
  const cancelUrl = `${APP_URL}/cancel/${booking.cancel_token}`;
  const joinLine = booking.webex_link ? `\nJoin Webex: ${booking.webex_link}` : "";
  const guestJoinLine = booking.webex_link
    ? `\n${tr(guestLocale, "mail_join", { link: booking.webex_link })}`
    : "";
  const method = kind === "cancelled" ? "CANCEL" : "REQUEST";
  // The host's invite (and email subject) leads with who's coming:
  // "<Company> - <Guest name>". The guest's invite leads with the meeting.
  const hostSummary = booking.guest_company
    ? `${booking.guest_company} - ${booking.guest_name}`
    : `${eventType.name} - ${booking.guest_name}`;
  // Exchange silently discards REQUEST invites whose recipient is the
  // ORGANIZER, so the host's copy must name the booking system as organizer
  // and the host as attendee. The guest's copy keeps host-as-organizer.
  const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;
  const system: IcsParty = { name: "Booking", email: fromEmail };
  // The calendar data rides as a single inline text/calendar MIME part with
  // no .ics file attachment — tested against Exchange/Apple Mail: the
  // attachment variant shows as a dead file, the inline-only variant
  // auto-surfaces in Calendar like Webex/Outlook invites.
  const calendarHeaders = { "Content-Class": "urn:content-classes:calendarmessage" };
  const icsFor = (summary: string, organizer: IcsParty, attendee: IcsParty) => [
    {
      contentType: `text/calendar; charset=utf-8; method=${method}`,
      content: buildIcs(booking, method, summary, organizer, attendee),
    },
  ];

  const subjectBase = `${eventType.name} with ${host.name}`;
  const results = await Promise.allSettled([
    t.sendMail({
      from,
      to: booking.guest_email,
      subject:
        kind === "confirmed"
          ? tr(guestLocale, "mail_confirmedSubject", { what: subjectBase, when: startGuest })
          : kind === "rescheduled"
            ? tr(guestLocale, "mail_rescheduledSubject", { what: subjectBase, when: startGuest })
            : tr(guestLocale, "mail_cancelledSubject", { what: subjectBase }),
      text:
        kind === "cancelled"
          ? `${tr(guestLocale, "mail_hi", { name: booking.guest_name })}\n\n${tr(guestLocale, "mail_cancelledBody")}\n\n${tr(guestLocale, "mail_whatPlain", { what: subjectBase })}\n${tr(guestLocale, "mail_when", { when: startGuest })}\n`
          : `${tr(guestLocale, "mail_hi", { name: booking.guest_name })}\n\n${tr(guestLocale, kind === "rescheduled" ? "mail_rescheduledBody" : "mail_confirmedBody")}\n\n${tr(guestLocale, "mail_what", { what: subjectBase, min: eventType.duration_min })}\n${tr(guestLocale, "mail_when", { when: startGuest })}${guestJoinLine}\n\n${tr(guestLocale, "mail_cancelLink", { url: cancelUrl })}\n`,
      alternatives: icsFor(
        subjectBase,
        { name: host.name, email: host.email },
        { name: booking.guest_name, email: booking.guest_email }
      ),
      headers: calendarHeaders,
    }),
    t.sendMail({
      from,
      to: host.email,
      subject:
        kind === "confirmed"
          ? hostSummary
          : kind === "rescheduled"
            ? `Rescheduled: ${hostSummary} — ${startHost}`
            : `Cancelled: ${hostSummary}`,
      text:
        kind === "confirmed"
          ? `${booking.guest_name} (${booking.guest_company || "no company given"}) <${booking.guest_email}> booked "${eventType.name}".\n\nWhen: ${startHost}${joinLine}\nNotes: ${booking.notes || "(none)"}\n`
          : kind === "rescheduled"
            ? `${booking.guest_name} (${booking.guest_company || "no company given"}) <${booking.guest_email}> moved "${eventType.name}".\n\nNew time: ${startHost}${joinLine}\n`
            : `${booking.guest_name} (${booking.guest_company || "no company given"}) <${booking.guest_email}> — booking "${eventType.name}" on ${startHost} was cancelled.\n`,
      alternatives: icsFor(hostSummary, system, { name: host.name, email: host.email }),
      headers: calendarHeaders,
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("Email send failed:", r.reason);
  }
}
