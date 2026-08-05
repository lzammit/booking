import { DateTime } from "luxon";
import db, { EventType, Host, Team, TeamEventType } from "./db";
import { computeSlots } from "./slots";

/**
 * Teams ("PSE"-style groups): one shared booking URL backed by several hosts.
 * A slot is offered when ANY member is free; booking assigns one free member
 * and becomes a perfectly normal booking on that host — so confirmation
 * emails, Webex, cancel/reschedule, the Mac agent, and ICS feeds all behave
 * exactly as if the guest had booked the member directly.
 */

export function teamBySlug(slug: string): Team | null {
  return (
    (db.prepare("SELECT * FROM teams WHERE slug = ?").get(slug) as Team | undefined) ??
    null
  );
}

export function teamMembers(teamId: number): Host[] {
  return db
    .prepare(
      `SELECT h.* FROM hosts h
       JOIN team_members m ON m.host_id = h.id
       WHERE m.team_id = ? ORDER BY h.name`
    )
    .all(teamId) as Host[];
}

/** A check-in older than this means the member's busy data can't be trusted. */
export const AGENT_FRESH_MINUTES = 15;

/**
 * Whether a member's busy data is current: a live agent check-in, or a
 * subscribed ICS feed (server-polled on demand, so always fresh at booking
 * time). Members without either are EXCLUDED from team slots and the
 * round-robin — with no busy sync the app would book over their real
 * meetings.
 */
export function memberConnected(host: Host): boolean {
  if (host.ics_url) return true;
  const row = db
    .prepare("SELECT MAX(last_sync) AS last FROM agent_syncs WHERE host_id = ?")
    .get(host.id) as { last: string | null };
  if (!row.last) return false;
  const dt = DateTime.fromSQL(row.last, { zone: "utc" });
  return dt.isValid && DateTime.utc().diff(dt, "minutes").minutes < AGENT_FRESH_MINUTES;
}

/**
 * Members who can take bookings for this team. With require_live_sync on
 * (the default), only members with current busy data participate. With it
 * off, everyone does — conflicts are still avoided against each member's
 * last-synced busy blocks (external_busy persists while an agent is offline),
 * so the residual risk is only meetings created since their last check-in.
 */
export function eligibleMembers(team: Team): Host[] {
  const members = teamMembers(team.id);
  return team.require_live_sync ? members.filter(memberConnected) : members;
}

/**
 * A member's availability for a team event type is computed with their OWN
 * rules/bookings/busy blocks but the TEAM event type's duration, buffer,
 * notice, and window — expressed as a synthetic EventType for computeSlots.
 */
function asMemberEventType(tet: TeamEventType, host: Host): EventType {
  return { ...tet, id: 0, host_id: host.id, team_event_type_id: tet.id };
}

/** Union of all members' free slots (UTC ISO strings, sorted, deduped). */
export async function computeTeamSlots(
  team: Team,
  tet: TeamEventType,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const members = eligibleMembers(team);
  const all = await Promise.all(
    members.map((m) => computeSlots(m, asMemberEventType(tet, m), fromDate, toDate))
  );
  return [...new Set(all.flat())].sort();
}

/**
 * Pick the member who takes a booking at `startUtcISO`: among members free at
 * that instant, the one with the fewest upcoming confirmed bookings wins
 * (ties broken randomly), so meetings spread evenly across the group.
 * Returns null when nobody is free (slot raced away).
 */
export async function pickMemberForSlot(
  team: Team,
  tet: TeamEventType,
  startUtcISO: string
): Promise<Host | null> {
  const start = DateTime.fromISO(startUtcISO, { zone: "utc" });
  if (!start.isValid) return null;
  const free: Host[] = [];
  for (const m of eligibleMembers(team)) {
    const day = start.setZone(m.timezone).toISODate();
    if (!day) continue;
    const slots = await computeSlots(m, asMemberEventType(tet, m), day, day);
    if (slots.includes(start.toISO()!)) free.push(m);
  }
  if (free.length === 0) return null;
  const load = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings WHERE host_id = ? AND status = 'confirmed' AND end_utc > ?"
  );
  const nowIso = DateTime.utc().toISO();
  const scored = free.map((h) => ({
    h,
    c: (load.get(h.id, nowIso) as { c: number }).c,
    r: Math.random(),
  }));
  scored.sort((a, b) => a.c - b.c || a.r - b.r);
  return scored[0].h;
}

/**
 * The booking row needs a real event_types row (FK + what emails/reschedule
 * read), so each member gets a hidden per-team-event-type "shadow" row,
 * created on first booking and kept in sync with the team event type after
 * edits. active=0 keeps it off the member's public page; team_event_type_id
 * keeps it out of their event-type editor.
 */
export function shadowEventTypeFor(host: Host, tet: TeamEventType): EventType {
  const existing = db
    .prepare("SELECT * FROM event_types WHERE host_id = ? AND team_event_type_id = ?")
    .get(host.id, tet.id) as EventType | undefined;
  if (existing) {
    db.prepare(
      `UPDATE event_types SET name=?, description=?, duration_min=?, buffer_min=?, min_notice_min=?, window_days=?, meeting_url=?, questions=?
       WHERE id = ?`
    ).run(
      tet.name,
      tet.description,
      tet.duration_min,
      tet.buffer_min,
      tet.min_notice_min,
      tet.window_days,
      tet.meeting_url,
      tet.questions,
      existing.id
    );
    return { ...existing, ...tet, id: existing.id, host_id: host.id, active: existing.active, team_event_type_id: tet.id };
  }
  const res = db
    .prepare(
      `INSERT INTO event_types (host_id, name, slug, description, duration_min, buffer_min, min_notice_min, window_days, active, meeting_url, questions, team_event_type_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(
      host.id,
      tet.name,
      // tet.id makes the slug unique per host even across teams/renames.
      `team-${tet.id}-${tet.slug}`.slice(0, 60),
      tet.description,
      tet.duration_min,
      tet.buffer_min,
      tet.min_notice_min,
      tet.window_days,
      tet.meeting_url,
      tet.questions,
      tet.id
    );
  return db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as EventType;
}
