import { DateTime } from "luxon";
import db, { Booking, getSetting, setSetting, Team } from "./db";
import { circadian, sendTeamDigestEmail } from "./email";
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

    const local = (iso: string) => DateTime.fromISO(iso, { zone: "utc" }).setZone(tz);
    const timeOf = (iso: string) => local(iso).toFormat("h:mm a");
    const line = (b: DigestBooking) =>
      `• ${timeOf(b.start_utc)}–${timeOf(b.end_utc)}  ${slackEscape(b.host_name)}: ${slackEscape(b.event_name)} — ${slackEscape(b.guest_name)}${b.guest_company ? ` (${slackEscape(b.guest_company)})` : ""}${b.team_name ? ` · via ${slackEscape(b.team_name)}` : ""}`;

    const results: string[] = [];
    if (team.digest_email) {
      const ok = await sendTeamDigestEmail(team.digest_email, tz, team.name, bookings);
      results.push(ok ? `email → ${team.digest_email}` : "email FAILED");
    }
    if (team.digest_slack_webhook) {
      // Same design language as the HTML email: one card per meeting whose
      // color bar (attachment color) is the circadian tint of its start hour.
      const MAX_CARDS = 19; // Slack caps attachments at 20; keep one for overflow
      const shown = bookings.slice(0, MAX_CARDS);
      const overflow = bookings.length - shown.length;
      const payload = {
        text: `${team.name} — bookings today, ${nowLocal.toFormat("ccc, LLL d")} (${bookings.length})`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: nowLocal.toFormat("cccc, LLLL d"), emoji: false },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `*${slackEscape(team.name.toUpperCase())}*  ·  ${bookings.length} MEETING${bookings.length === 1 ? "" : "S"}  ·  ${tz.replace(/_/g, " ").toUpperCase()}`,
              },
            ],
          },
        ],
        attachments: [
          ...shown.map((b) => {
            const start = local(b.start_utc);
            return {
              color: circadian(start.hour + start.minute / 60),
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text:
                      `*${timeOf(b.start_utc)} – ${timeOf(b.end_utc)}*   ${slackEscape(b.event_name)} — *${slackEscape(b.guest_name)}*${b.guest_company ? ` (${slackEscape(b.guest_company)})` : ""}\n` +
                      `_with ${slackEscape(b.host_name)}_${b.team_name ? `  ·  via ${slackEscape(b.team_name)}` : ""}${b.webex_link ? `  ·  <${b.webex_link}|Join>` : ""}`,
                  },
                },
              ],
            };
          }),
          ...(overflow > 0
            ? [
                {
                  color: "#9aa0ab",
                  blocks: [
                    {
                      type: "section",
                      text: { type: "mrkdwn", text: `_…and ${overflow} more — see the dashboard._` },
                    },
                  ],
                },
              ]
            : []),
        ],
      };
      let ok = await postSlackMessage(team.digest_slack_webhook, payload);
      if (!ok) {
        // Block Kit rejected? Fall back to the plain-text digest rather than
        // silently dropping the day's summary.
        ok = await postSlackMessage(
          team.digest_slack_webhook,
          [`*${slackEscape(team.name)} — bookings today, ${nowLocal.toFormat("cccc, LLLL d")}* (${bookings.length})`, ...bookings.map(line)].join("\n")
        );
      }
      results.push(ok ? "slack → posted" : "slack FAILED");
    }
    if (results.some((r) => !r.includes("FAILED")) && !force) setSetting(marker, today);
    out.push(`${team.name}: ${results.join(", ")}`);
  }
  return out;
}
