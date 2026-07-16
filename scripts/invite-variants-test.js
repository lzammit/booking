/* Send three invite structure variants to compare Exchange auto-processing.
 * Run on the server: node scripts/invite-variants-test.js <recipient>
 */
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const to = process.argv[2] || "you@example.com";
const from = env.SMTP_FROM || "Booking <booking@example.com>";
const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;

const t = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

// Event: Jul 20 2026, 15:00-15:30 EDT (19:00Z)
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

function icsUtc(uid, summary) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//booking//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}@booking.example.com`,
    `DTSTAMP:${stamp}`,
    "DTSTART:20260720T190000Z",
    "DTEND:20260720T193000Z",
    `SUMMARY:${summary}`,
    "DESCRIPTION:Invite structure test",
    `ORGANIZER;CN=Booking:mailto:${fromEmail}`,
    `ATTENDEE;CN=Test Recipient;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${to}`,
    "TRANSP:OPAQUE",
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function icsWebexStyle(uid, summary) {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Microsoft Corporation//Outlook 10.0 MIMEDIR//EN",
    "VERSION:2.0",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZNAME:EDT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZNAME:EST",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `DTSTAMP:${stamp}`,
    `ATTENDEE;CN="Test Recipient";ROLE=REQ-PARTICIPANT;RSVP=TRUE:MAILTO:${to}`,
    `ORGANIZER;CN="Booking":MAILTO:${fromEmail}`,
    "DTSTART;TZID=America/New_York:20260720T150000",
    "DTEND;TZID=America/New_York:20260720T153000",
    "TRANSP:OPAQUE",
    "SEQUENCE:0",
    `UID:${uid}@booking.example.com`,
    "DESCRIPTION:Invite structure test",
    `SUMMARY:${summary}`,
    "PRIORITY:5",
    "CLASS:PUBLIC",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

async function main() {
  // A: current app format — nodemailer icalEvent (alternative + ics attachment)
  await t.sendMail({
    from,
    to,
    subject: "Invite variant A (icalEvent)",
    text: "Variant A: nodemailer icalEvent, UTC times.",
    icalEvent: { method: "REQUEST", filename: "invite.ics", content: icsUtc("variant-a", "Invite variant A") },
  });

  // B: single inline text/calendar alternative, no file attachment, content-class header
  await t.sendMail({
    from,
    to,
    subject: "Invite variant B (inline only)",
    text: "Variant B: single inline text/calendar part, no attachment.",
    alternatives: [
      {
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        content: icsUtc("variant-b", "Invite variant B"),
      },
    ],
    headers: { "Content-Class": "urn:content-classes:calendarmessage" },
  });

  // C: like B but Webex-style ICS (VTIMEZONE, TZID local times, Outlook PRODID)
  await t.sendMail({
    from,
    to,
    subject: "Invite variant C (webex-style)",
    text: "Variant C: inline part with Webex-style VEVENT.",
    alternatives: [
      {
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        content: icsWebexStyle("variant-c", "Invite variant C"),
      },
    ],
    headers: { "Content-Class": "urn:content-classes:calendarmessage" },
  });

  console.log("sent A, B, C to", to);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
