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

/** Password-reset link. Best effort — never reveals whether the address exists. */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  try {
    await t.sendMail({
      from,
      to,
      subject: "Reset your Booking password",
      text: `Hi ${name},\n\nSomeone asked to reset the password for your Booking account. If that was you, open this link to choose a new one:\n\n${resetUrl}\n\nThe link expires in one hour. If you didn't request this, you can ignore this email — your password stays unchanged.\n`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333;">
<p>Hi ${name},</p>
<p>Someone asked to reset the password for your Booking account. If that was you, choose a new one:</p>
<p style="margin: 20px 0;"><a href="${resetUrl}" style="display: inline-block; background-color: #1C2333; color: #FBFAF7; text-decoration: none; font-weight: bold; padding: 10px 18px; border-radius: 8px;">Reset password</a></p>
<p style="color: #6b7280; font-size: 12px;">Or open: <a href="${resetUrl}" style="color: #0563C1;">${resetUrl}</a></p>
<p style="color: #6b7280; font-size: 12px;">The link expires in one hour. If you didn't request this, ignore this email — your password stays unchanged.</p>
</div>`,
    });
    return true;
  } catch (err) {
    console.error("Password reset email failed:", err);
    return false;
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

// ----- Digest HTML (shared by the personal agenda and team digest) -----
//
// Matches the app's visual identity: paper/ink colors, mono uppercase
// kickers, and the circadian scale — each meeting is tinted by its local
// start hour (dawn coral → noon gold → dusk violet), same as the booking
// widget's slots. Email-safe: tables + inline styles only, no images, no
// external resources; a plain-text part always rides along.

const DAWN: [number, number, number] = [240, 152, 126]; // 06:00
const NOON: [number, number, number] = [237, 190, 75]; // 12:00
const DUSK: [number, number, number] = [124, 111, 217]; // 20:00

function circadian(hourDecimal: number): string {
  const h = Math.min(20, Math.max(6, hourDecimal));
  const [from, to, t] = h <= 12 ? [DAWN, NOON, (h - 6) / 6] : [NOON, DUSK, (h - 12) / 8];
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MONO = "'SF Mono',Menlo,Consolas,'Courier New',monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";

interface DigestItem {
  color: string; // circadian tint for this meeting
  time: string; // "1:00 PM – 1:30 PM"
  title: string;
  sub: string;
  tag?: string; // "via <team>"
  join?: string; // meeting link
}

function renderDigestHtml(params: {
  kicker: string;
  title: string;
  subtitle: string;
  items: DigestItem[];
  footerNote: string;
}): string {
  // The day-arc: the app's gradient signature, as six solid cells so it
  // renders in clients that ignore CSS gradients (Outlook desktop).
  const arcColors = [6, 8.8, 11.6, 14.4, 17.2, 20].map(circadian);
  const arc = arcColors
    .map(
      (c, i) =>
        `<td width="18" height="4" style="background:${c};font-size:0;line-height:0;${i === 0 ? "border-radius:2px 0 0 2px;" : ""}${i === arcColors.length - 1 ? "border-radius:0 2px 2px 0;" : ""}">&nbsp;</td>`
    )
    .join("");

  const rows = params.items
    .map(
      (it) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ecebe6;border-radius:12px;margin-bottom:10px;background:#ffffff;">
        <tr>
          <td width="6" style="background:${it.color};border-radius:12px 0 0 12px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding:13px 16px;">
            <div style="font-family:${MONO};font-size:12px;color:#1C2333;letter-spacing:0.5px;">${htmlEscape(it.time)}</div>
            <div style="font-family:${SANS};font-size:15px;font-weight:600;color:#1C2333;padding-top:3px;">${htmlEscape(it.title)}</div>
            <div style="font-family:${SANS};font-size:13px;color:#6b7280;padding-top:2px;">${htmlEscape(it.sub)}${
              it.tag
                ? `&nbsp; <span style="font-family:${SANS};font-size:11px;color:#7C6FD9;background:#f4f1fc;border:1px solid #e2daf6;border-radius:999px;padding:1px 8px;white-space:nowrap;">${htmlEscape(it.tag)}</span>`
                : ""
            }</div>
          </td>
          ${
            it.join
              ? `<td align="right" style="padding:0 14px 0 4px;white-space:nowrap;vertical-align:middle;">
                   <a href="${htmlEscape(it.join)}" style="display:inline-block;background:#1C2333;color:#FBFAF7;font-family:${SANS};font-size:12px;font-weight:600;text-decoration:none;padding:8px 16px;border-radius:8px;">Join</a>
                 </td>`
              : ""
          }
        </tr>
      </table>`
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#FBFAF7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBFAF7;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
      <tr><td style="background:#ffffff;border:1px solid #e8e6e0;border-radius:16px;padding:30px 30px 24px;">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:3px;color:#9aa0ab;text-transform:uppercase;">${htmlEscape(params.kicker)}</div>
        <div style="font-family:${SANS};font-size:27px;font-weight:700;color:#1C2333;padding-top:8px;letter-spacing:-0.5px;">${htmlEscape(params.title)}</div>
        <div style="font-family:${MONO};font-size:12px;color:#9aa0ab;padding-top:5px;text-transform:uppercase;letter-spacing:1px;">${htmlEscape(params.subtitle)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 22px;"><tr>${arc}</tr></table>
        ${rows}
        <div style="padding-top:12px;">
          <a href="${APP_URL}/dashboard" style="font-family:${MONO};font-size:12px;color:#4661c8;text-decoration:none;letter-spacing:0.5px;">Open dashboard &rarr;</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 10px 0;text-align:center;">
        <div style="font-family:${MONO};font-size:11px;color:#b3b7c0;line-height:1.6;">${htmlEscape(params.footerNote)}</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Morning agenda: today's confirmed meetings for one host. Best effort. */
export async function sendDailyAgendaEmail(
  host: Host,
  bookings: (Booking & { event_name: string; team_name: string | null })[]
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const day = DateTime.utc().setZone(host.timezone);
  const local = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(host.timezone);
  const timeOf = (iso: string) => local(iso).toFormat("h:mm a");
  const lines = bookings.map((b) => {
    const bits = [
      `${timeOf(b.start_utc)}–${timeOf(b.end_utc)}`,
      `${b.event_name} — ${b.guest_name}${b.guest_company ? ` (${b.guest_company})` : ""}`,
    ];
    if (b.team_name) bits.push(`via ${b.team_name}`);
    if (b.webex_link) bits.push(`Join: ${b.webex_link}`);
    return `• ${bits.join("  ·  ")}`;
  });
  const html = renderDigestHtml({
    kicker: `Good morning ${host.name.split(" ")[0]}`,
    title: day.toFormat("cccc, LLLL d"),
    subtitle: `${bookings.length} meeting${bookings.length === 1 ? "" : "s"} · ${host.timezone.replace(/_/g, " ")}`,
    items: bookings.map((b) => {
      const start = local(b.start_utc);
      return {
        color: circadian(start.hour + start.minute / 60),
        time: `${timeOf(b.start_utc)} – ${timeOf(b.end_utc)}`,
        title: b.event_name,
        sub: `${b.guest_name}${b.guest_company ? ` (${b.guest_company})` : ""}`,
        tag: b.team_name ? `via ${b.team_name}` : undefined,
        join: b.webex_link ?? undefined,
      };
    }),
    footerNote:
      "You get this because Morning agenda email is on — Settings → Notifications to turn it off.",
  });
  try {
    await t.sendMail({
      from,
      to: host.email,
      subject: `Today: ${bookings.length} meeting${bookings.length === 1 ? "" : "s"} — ${day.toFormat("ccc, LLL d")}`,
      text: `Good morning ${host.name.split(" ")[0]},\n\nYour bookings today (${day.toFormat("cccc, LLLL d")}, ${host.timezone}):\n\n${lines.join("\n")}\n\nDashboard: ${APP_URL}/dashboard\n`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Daily agenda email failed:", err);
    return false;
  }
}

/** Team digest: the team members' meetings today, to one chosen address. */
export async function sendTeamDigestEmail(
  to: string,
  tz: string,
  teamName: string,
  bookings: (Booking & { event_name: string; team_name: string | null; host_name: string })[]
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const day = DateTime.utc().setZone(tz);
  const local = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
  const timeOf = (iso: string) => local(iso).toFormat("h:mm a");
  const lines = bookings.map(
    (b) =>
      `• ${timeOf(b.start_utc)}–${timeOf(b.end_utc)}  ${b.host_name}: ${b.event_name} — ${b.guest_name}${b.guest_company ? ` (${b.guest_company})` : ""}${b.team_name ? ` · via ${b.team_name}` : ""}`
  );
  const html = renderDigestHtml({
    kicker: teamName,
    title: day.toFormat("cccc, LLLL d"),
    subtitle: `${bookings.length} meeting${bookings.length === 1 ? "" : "s"} · ${tz.replace(/_/g, " ")}`,
    items: bookings.map((b) => {
      const start = local(b.start_utc);
      return {
        color: circadian(start.hour + start.minute / 60),
        time: `${timeOf(b.start_utc)} – ${timeOf(b.end_utc)}`,
        title: `${b.event_name} — ${b.guest_name}${b.guest_company ? ` (${b.guest_company})` : ""}`,
        sub: `with ${b.host_name}`,
        tag: b.team_name ? `via ${b.team_name}` : undefined,
      };
    }),
    footerNote: `Daily digest for ${teamName} — configured in Admin → Teams.`,
  });
  try {
    await t.sendMail({
      from,
      to,
      subject: `${teamName} — bookings today: ${bookings.length} — ${day.toFormat("ccc, LLL d")}`,
      text: `${teamName} bookings for ${day.toFormat("cccc, LLLL d")} (${tz}):\n\n${lines.join("\n")}\n\nDashboard: ${APP_URL}/dashboard\n`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Team digest email failed:", err);
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
