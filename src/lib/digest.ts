import { DateTime } from "luxon";
import db, { Booking, getSetting, setSetting, Team } from "./db";
import { sendTeamDigestEmail } from "./email";
import { postSlackMessage, slackEscape } from "./slack";

export type DigestBooking = Booking & {
  event_name: string;
  team_name: string | null;
  host_name: string;
};

/**
 * Per-team morning digests: every confirmed booking happening today for the
 * team's members (their whole day, with via-team tags), sent to the team's
 * digest email and/or Slack webhook. Cron calls this hourly with force=false —
 * each configured team fires once, at 07:00 in its own digest timezone.
 * force=true (the admin "Send now" button) skips the hour gate and the
 * once-per-day marker, and doesn't set the marker, so a test never eats the
 * real morning send.
 */
export async function runTeamDigests(force = false, onlyTeamId?: number): Promise<string[]> {
  const teams = db.prepare("SELECT * FROM teams ORDER BY name").all() as Team[];
  const out: string[] = [];
  for (const team of teams) {
    if (onlyTeamId && team.id !== onlyTeamId) continue;
    if (!team.digest_email && !team.digest_slack_webhook) {
      if (onlyTeamId) out.push(`${team.name}: no destinations configured`);
      continue;
    }
    const tz = team.digest_tz || "UTC";
    const nowLocal = DateTime.utc().setZone(tz);
    if (!nowLocal.isValid) continue;
    const today = nowLocal.toISODate()!;
    const marker = `digest:team:${team.id}`;
    if (!force && nowLocal.hour !== 7) continue;
    if (!force && getSetting(marker) === today) continue;

    const bookings = db
      .prepare(
        `SELECT b.*, e.name AS event_name, t2.name AS team_name, h.name AS host_name
         FROM bookings b
         JOIN team_members m ON m.host_id = b.host_id AND m.team_id = ?
         JOIN hosts h ON h.id = b.host_id
         JOIN event_types e ON e.id = b.event_type_id
         LEFT JOIN teams t2 ON t2.id = b.team_id
         WHERE b.status = 'confirmed' AND b.start_utc >= ? AND b.start_utc <= ?
         ORDER BY b.start_utc`
      )
      .all(
        team.id,
        nowLocal.startOf("day").toUTC().toISO(),
        nowLocal.endOf("day").toUTC().toISO()
      ) as DigestBooking[];
    if (bookings.length === 0) {
      if (force) out.push(`${team.name}: no bookings today`);
      continue;
    }

    const timeOf = (iso: string) =>
      DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("h:mm a");
    const line = (b: DigestBooking, esc: (s: string) => string) =>
      `• ${timeOf(b.start_utc)}–${timeOf(b.end_utc)}  ${esc(b.host_name)}: ${esc(b.event_name)} — ${esc(b.guest_name)}${b.guest_company ? ` (${esc(b.guest_company)})` : ""}${b.team_name ? ` · via ${esc(b.team_name)}` : ""}`;

    const results: string[] = [];
    if (team.digest_email) {
      const ok = await sendTeamDigestEmail(team.digest_email, tz, team.name, bookings);
      results.push(ok ? `email → ${team.digest_email}` : "email FAILED");
    }
    if (team.digest_slack_webhook) {
      const header = `*${slackEscape(team.name)} — bookings today, ${nowLocal.toFormat("cccc, LLLL d")}* (${bookings.length})`;
      const text = [header, ...bookings.map((b) => line(b, slackEscape))].join("\n");
      const ok = await postSlackMessage(team.digest_slack_webhook, text);
      results.push(ok ? "slack → posted" : "slack FAILED");
    }
    if (results.some((r) => !r.includes("FAILED")) && !force) setSetting(marker, today);
    out.push(`${team.name}: ${results.join(", ")}`);
  }
  return out;
}
