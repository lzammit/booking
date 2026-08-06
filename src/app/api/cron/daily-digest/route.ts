import { createHash, timingSafeEqual } from "crypto";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import db, { Booking, getSetting, Host, setSetting } from "@/lib/db";
import { sendDailyAgendaEmail } from "@/lib/email";
import { runTeamDigests } from "@/lib/digest";

/**
 * Morning agenda digests. Meant to be hit hourly by cron (Bearer CRON_SECRET):
 * each host whose local time is 07:00 and who has confirmed meetings today
 * gets one email. A settings marker makes the send idempotent per day, so an
 * extra cron run never double-mails anyone.
 *
 * Debug knobs (still secret-gated): ?force=1 skips the hour + idempotency
 * checks, ?host=<id> restricts to one host.
 */

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const onlyHost = Number(req.nextUrl.searchParams.get("host")) || null;

  const hosts = db.prepare("SELECT * FROM hosts").all() as Host[];
  let sent = 0;
  const skipped: string[] = [];
  for (const h of hosts) {
    if (onlyHost && h.id !== onlyHost) continue;
    if (!h.agenda_email) {
      skipped.push(`${h.slug}: agenda email off`);
      continue;
    }
    const nowLocal = DateTime.utc().setZone(h.timezone);
    if (!nowLocal.isValid) continue;
    if (!force && nowLocal.hour !== 7) continue;
    const today = nowLocal.toISODate()!;
    if (!force && getSetting(`digest:${h.id}`) === today) continue;

    const bookings = db
      .prepare(
        `SELECT b.*, e.name AS event_name, t.name AS team_name FROM bookings b
         JOIN event_types e ON e.id = b.event_type_id
         LEFT JOIN teams t ON t.id = b.team_id
         WHERE b.host_id = ? AND b.status = 'confirmed' AND b.start_utc >= ? AND b.start_utc <= ?
         ORDER BY b.start_utc`
      )
      .all(
        h.id,
        nowLocal.startOf("day").toUTC().toISO(),
        nowLocal.endOf("day").toUTC().toISO()
      ) as (Booking & { event_name: string; team_name: string | null })[];
    if (bookings.length === 0) {
      skipped.push(`${h.slug}: no meetings`);
      continue;
    }
    if (await sendDailyAgendaEmail(h, bookings)) {
      setSetting(`digest:${h.id}`, today);
      sent++;
    }
  }
  // Per-team digests to each team's email/Slack destinations. Skipped in
  // single-host debug runs so ?host= tests never spam shared channels.
  const teams = onlyHost ? ["skipped (host filter)"] : await runTeamDigests(force);

  return NextResponse.json({ ok: true, sent, skipped, teams });
}
