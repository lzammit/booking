import { DateTime } from "luxon";
import db, { Booking, getSetting, setSetting } from "./db";
import { sendCombinedDigestEmail } from "./email";
import { postSlackMessage, slackEscape } from "./slack";

export type DigestBooking = Booking & {
  event_name: string;
  team_name: string | null;
  host_name: string;
};

/**
 * The org-wide daily digest: every confirmed booking happening today (in the
 * configured digest timezone), sent to the extra email address and/or Slack
 * webhook from the admin "Daily digest" settings. Cron calls this hourly with
 * force=false — it fires once, at 07:00 local. force=true (the admin "Send
 * now" button) skips the hour gate and the once-per-day marker, and doesn't
 * set the marker, so a test never eats the real morning send.
 */
export async function runCombinedDigest(force = false): Promise<string> {
  const email = getSetting("digest_email") ?? "";
  const webhook = getSetting("digest_slack_webhook") ?? "";
  if (!email && !webhook) return "not configured";

  const tz = getSetting("digest_tz") || "UTC";
  const nowLocal = DateTime.utc().setZone(tz);
  if (!nowLocal.isValid) return "bad timezone";
  const today = nowLocal.toISODate()!;
  if (!force && nowLocal.hour !== 7) return "outside send hour";
  if (!force && getSetting("digest:combined") === today) return "already sent today";

  const bookings = db
    .prepare(
      `SELECT b.*, e.name AS event_name, t.name AS team_name, h.name AS host_name
       FROM bookings b
       JOIN hosts h ON h.id = b.host_id
       JOIN event_types e ON e.id = b.event_type_id
       LEFT JOIN teams t ON t.id = b.team_id
       WHERE b.status = 'confirmed' AND b.start_utc >= ? AND b.start_utc <= ?
       ORDER BY b.start_utc`
    )
    .all(
      nowLocal.startOf("day").toUTC().toISO(),
      nowLocal.endOf("day").toUTC().toISO()
    ) as DigestBooking[];
  if (bookings.length === 0) return "no bookings today";

  const timeOf = (iso: string) =>
    DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("h:mm a");
  const line = (b: DigestBooking, esc: (s: string) => string) =>
    `• ${timeOf(b.start_utc)}–${timeOf(b.end_utc)}  ${esc(b.host_name)}: ${esc(b.event_name)} — ${esc(b.guest_name)}${b.guest_company ? ` (${esc(b.guest_company)})` : ""}${b.team_name ? ` · via ${esc(b.team_name)}` : ""}`;

  const results: string[] = [];
  if (email) {
    const ok = await sendCombinedDigestEmail(email, tz, bookings);
    results.push(ok ? `email → ${email}` : `email FAILED`);
  }
  if (webhook) {
    const header = `*Bookings today — ${nowLocal.toFormat("cccc, LLLL d")}* (${bookings.length})`;
    const text = [header, ...bookings.map((b) => line(b, slackEscape))].join("\n");
    const ok = await postSlackMessage(webhook, text);
    results.push(ok ? "slack → posted" : "slack FAILED");
  }
  const anyOk = results.some((r) => !r.includes("FAILED"));
  if (anyOk && !force) setSetting("digest:combined", today);
  return results.join(", ");
}
