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
  `);
  const bookingCols2 = db.prepare("PRAGMA table_info(bookings)").all() as { name: string }[];
  if (!bookingCols2.some((c) => c.name === "webex_link")) {
    db.exec("ALTER TABLE bookings ADD COLUMN webex_link TEXT");
  }
  if (!bookingCols2.some((c) => c.name === "webex_meeting_id")) {
    db.exec("ALTER TABLE bookings ADD COLUMN webex_meeting_id TEXT");
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
  guest_name: string;
  guest_email: string;
  guest_company: string;
  guest_timezone: string;
  notes: string;
  start_utc: string;
  end_utc: string;
  status: string;
  cancel_token: string;
  ms_event_id: string | null;
  webex_link: string | null;
  webex_meeting_id: string | null;
  created_at: string;
}
