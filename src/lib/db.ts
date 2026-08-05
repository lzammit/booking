import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import path from "path";
import fs from "fs";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

function createDb() {
  const db = new Database(path.join(dataDir, "booking.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Montreal',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      duration_min INTEGER NOT NULL DEFAULT 30,
      buffer_min INTEGER NOT NULL DEFAULT 0,
      min_notice_min INTEGER NOT NULL DEFAULT 120,
      window_days INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(host_id, slug)
    );
    CREATE TABLE IF NOT EXISTS availability_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL, -- 1=Monday .. 7=Sunday (luxon convention)
      start_min INTEGER NOT NULL, -- minutes from midnight, host timezone
      end_min INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      event_type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
      guest_name TEXT NOT NULL,
      guest_email TEXT NOT NULL,
      guest_timezone TEXT NOT NULL DEFAULT 'UTC',
      notes TEXT NOT NULL DEFAULT '',
      start_utc TEXT NOT NULL, -- ISO 8601 UTC
      end_utc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
      cancel_token TEXT NOT NULL UNIQUE,
      ms_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_host_time ON bookings(host_id, start_utc);
    CREATE TABLE IF NOT EXISTS ms_tokens (
      host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      account_email TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL -- unix seconds
    );
    CREATE TABLE IF NOT EXISTS external_busy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source TEXT NOT NULL, -- e.g. 'mac-eventkit'
      start_utc TEXT NOT NULL,
      end_utc TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_external_busy_host ON external_busy(host_id, start_utc);
    CREATE TABLE IF NOT EXISTS agent_syncs (
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      last_sync TEXT NOT NULL DEFAULT (datetime('now')),
      blocks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (host_id, source)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webex_tokens (
      host_id INTEGER PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      account_email TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL -- unix seconds
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY, -- sha256 of the emailed token (never store raw)
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, -- unix seconds
      used_at INTEGER -- unix seconds; null until consumed
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_host ON password_resets(host_id);
    CREATE TABLE IF NOT EXISTS teams (
      -- A group of hosts (e.g. "PSE") booked round-robin from one shared URL.
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE, -- public URL: /team/<slug>
      -- 1 = only members with live busy sync take bookings; 0 = offline
      -- members too, relying on their last-synced busy data for conflicts.
      require_live_sync INTEGER NOT NULL DEFAULT 1,
      -- Morning digest of members' bookings: optional email and/or Slack
      -- incoming-webhook destination, sent at 07:00 in digest_tz.
      digest_email TEXT NOT NULL DEFAULT '',
      digest_slack_webhook TEXT NOT NULL DEFAULT '',
      digest_tz TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS team_members (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      PRIMARY KEY (team_id, host_id)
    );
    CREATE TABLE IF NOT EXISTS team_event_types (
      -- Meeting types offered on the team page. A slot is open when ANY member
      -- is free; booking assigns one free member (see lib/teams.ts).
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      duration_min INTEGER NOT NULL DEFAULT 30,
      buffer_min INTEGER NOT NULL DEFAULT 0,
      min_notice_min INTEGER NOT NULL DEFAULT 120,
      window_days INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      meeting_url TEXT NOT NULL DEFAULT '',
      questions TEXT NOT NULL DEFAULT '', -- one booking question per line
      UNIQUE(team_id, slug)
    );
    CREATE TABLE IF NOT EXISTS slug_aliases (
      -- Previously-used booking slugs. When a host renames their link, the old
      -- slug is parked here so shared links / email signatures keep working
      -- (the booking page 308-redirects an alias to the current slug).
      slug TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE
    );
  `);
  const bookingCols2 = db.prepare("PRAGMA table_info(bookings)").all() as { name: string }[];
  if (!bookingCols2.some((c) => c.name === "webex_link")) {
    db.exec("ALTER TABLE bookings ADD COLUMN webex_link TEXT");
  }
  if (!bookingCols2.some((c) => c.name === "webex_meeting_id")) {
    db.exec("ALTER TABLE bookings ADD COLUMN webex_meeting_id TEXT");
  }
  if (!bookingCols2.some((c) => c.name === "guest_locale")) {
    db.exec("ALTER TABLE bookings ADD COLUMN guest_locale TEXT NOT NULL DEFAULT 'en'");
  }
  if (!bookingCols2.some((c) => c.name === "sequence")) {
    // iCalendar SEQUENCE: bumped on each reschedule so calendar clients
    // update the existing event (same UID) instead of keeping the old time.
    db.exec("ALTER TABLE bookings ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0");
  }
  // Seed the signup code from the env once, so it becomes UI-manageable.
  if (
    process.env.SIGNUP_CODE &&
    !db.prepare("SELECT 1 FROM settings WHERE key = 'signup_code'").get()
  ) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('signup_code', ?)").run(
      process.env.SIGNUP_CODE
    );
  }
  const hostCols = db.prepare("PRAGMA table_info(hosts)").all() as { name: string }[];
  if (!hostCols.some((c) => c.name === "api_token")) {
    db.exec("ALTER TABLE hosts ADD COLUMN api_token TEXT");
  }
  const bookingCols = db.prepare("PRAGMA table_info(bookings)").all() as { name: string }[];
  if (!bookingCols.some((c) => c.name === "guest_company")) {
    db.exec("ALTER TABLE bookings ADD COLUMN guest_company TEXT NOT NULL DEFAULT ''");
  }
  if (!hostCols.some((c) => c.name === "is_admin")) {
    db.exec("ALTER TABLE hosts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  const etCols = db.prepare("PRAGMA table_info(event_types)").all() as { name: string }[];
  if (!etCols.some((c) => c.name === "meeting_url")) {
    db.exec("ALTER TABLE event_types ADD COLUMN meeting_url TEXT NOT NULL DEFAULT ''");
  }
  if (!etCols.some((c) => c.name === "team_event_type_id")) {
    // Marks a hidden per-member "shadow" of a team event type (see lib/teams.ts).
    // Shadow rows are excluded from the host's event-type editor and public page.
    db.exec("ALTER TABLE event_types ADD COLUMN team_event_type_id INTEGER");
  }
  if (!bookingCols.some((c) => c.name === "team_id")) {
    // Set when the booking came through a team page, for the "via <team>" label.
    db.exec("ALTER TABLE bookings ADD COLUMN team_id INTEGER");
  }
  const teamCols = db.prepare("PRAGMA table_info(teams)").all() as { name: string }[];
  if (!teamCols.some((c) => c.name === "require_live_sync")) {
    db.exec("ALTER TABLE teams ADD COLUMN require_live_sync INTEGER NOT NULL DEFAULT 1");
  }
  if (!teamCols.some((c) => c.name === "digest_email")) {
    db.exec("ALTER TABLE teams ADD COLUMN digest_email TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE teams ADD COLUMN digest_slack_webhook TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE teams ADD COLUMN digest_tz TEXT NOT NULL DEFAULT ''");
  }
  // Booking questions, asked on the public form (one per line).
  if (!etCols.some((c) => c.name === "questions")) {
    db.exec("ALTER TABLE event_types ADD COLUMN questions TEXT NOT NULL DEFAULT ''");
  }
  const tetCols = db.prepare("PRAGMA table_info(team_event_types)").all() as { name: string }[];
  if (!tetCols.some((c) => c.name === "questions")) {
    db.exec("ALTER TABLE team_event_types ADD COLUMN questions TEXT NOT NULL DEFAULT ''");
  }
  if (!hostCols.some((c) => c.name === "ics_url")) {
    db.exec("ALTER TABLE hosts ADD COLUMN ics_url TEXT");
  }
  if (!hostCols.some((c) => c.name === "feed_token")) {
    db.exec("ALTER TABLE hosts ADD COLUMN feed_token TEXT");
  }
  const tokenless = db
    .prepare("SELECT id FROM hosts WHERE api_token IS NULL OR api_token = ''")
    .all() as { id: number }[];
  const setToken = db.prepare("UPDATE hosts SET api_token = ? WHERE id = ?");
  for (const h of tokenless) setToken.run(randomBytes(24).toString("hex"), h.id);
  const feedless = db
    .prepare("SELECT id FROM hosts WHERE feed_token IS NULL OR feed_token = ''")
    .all() as { id: number }[];
  const setFeedToken = db.prepare("UPDATE hosts SET feed_token = ? WHERE id = ?");
  for (const h of feedless) setFeedToken.run(randomBytes(24).toString("hex"), h.id);
  return db;
}

// Reuse one connection across Next.js dev-mode module reloads.
const globalForDb = globalThis as unknown as { _bookingDb?: Database.Database };
const db = globalForDb._bookingDb ?? createDb();
globalForDb._bookingDb = db;

export default db;

/**
 * Resolve a booking slug to its host. Current slugs win; a slug that was
 * renamed away resolves through slug_aliases so old links keep working.
 * `aliased` is true when the lookup matched a parked (old) slug — the caller
 * should redirect to the host's current slug.
 */
export function hostBySlug(slug: string): { host: Host; aliased: boolean } | null {
  const host = db.prepare("SELECT * FROM hosts WHERE slug = ?").get(slug) as
    | Host
    | undefined;
  if (host) return { host, aliased: false };
  const alias = db
    .prepare("SELECT host_id FROM slug_aliases WHERE slug = ?")
    .get(slug) as { host_id: number } | undefined;
  if (!alias) return null;
  const aliasedHost = db
    .prepare("SELECT * FROM hosts WHERE id = ?")
    .get(alias.host_id) as Host | undefined;
  return aliasedHost ? { host: aliasedHost, aliased: true } : null;
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/** Current signup invite code; empty string means signup is open. */
export function signupCode(): string {
  return getSetting("signup_code") ?? process.env.SIGNUP_CODE ?? "";
}

/**
 * Special onboarding code that grants admin on signup. Empty string means no
 * admin code is set (nobody can self-onboard as admin). Distinct from the
 * regular signup code.
 */
export function adminCode(): string {
  return getSetting("admin_code") ?? "";
}

/** Whether the admin onboarding code is currently active. Default: enabled. */
export function adminCodeEnabled(): boolean {
  return getSetting("admin_code_enabled") !== "0";
}

export interface Host {
  id: number;
  email: string;
  name: string;
  slug: string;
  password_hash: string;
  timezone: string;
  api_token: string;
  is_admin: number;
  ics_url: string | null;
  feed_token: string;
}

export interface EventType {
  id: number;
  host_id: number;
  name: string;
  slug: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  min_notice_min: number;
  window_days: number;
  active: number;
  meeting_url: string;
  questions: string;
  team_event_type_id: number | null;
}

/** Booking questions as a clean list: one per line, trimmed, max 10. */
export function questionList(questions: string | null | undefined): string[] {
  return (questions ?? "")
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  require_live_sync: number;
  digest_email: string;
  digest_slack_webhook: string;
  digest_tz: string;
  created_at: string;
}

export interface TeamEventType {
  id: number;
  team_id: number;
  name: string;
  slug: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  min_notice_min: number;
  window_days: number;
  active: number;
  meeting_url: string;
  questions: string;
}

export interface AvailabilityRule {
  id: number;
  host_id: number;
  weekday: number;
  start_min: number;
  end_min: number;
}

export interface Booking {
  id: number;
  host_id: number;
  event_type_id: number;
  team_id: number | null;
  guest_name: string;
  guest_email: string;
  guest_company: string;
  guest_timezone: string;
  guest_locale: string;
  notes: string;
  start_utc: string;
  end_utc: string;
  status: string;
  cancel_token: string;
  ms_event_id: string | null;
  webex_link: string | null;
  webex_meeting_id: string | null;
  sequence: number;
  created_at: string;
}
