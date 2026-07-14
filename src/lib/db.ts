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
  `);
  const hostCols = db.prepare("PRAGMA table_info(hosts)").all() as { name: string }[];
  if (!hostCols.some((c) => c.name === "api_token")) {
    db.exec("ALTER TABLE hosts ADD COLUMN api_token TEXT");
  }
  const tokenless = db
    .prepare("SELECT id FROM hosts WHERE api_token IS NULL OR api_token = ''")
    .all() as { id: number }[];
  const setToken = db.prepare("UPDATE hosts SET api_token = ? WHERE id = ?");
  for (const h of tokenless) setToken.run(randomBytes(24).toString("hex"), h.id);
  return db;
}

// Reuse one connection across Next.js dev-mode module reloads.
const globalForDb = globalThis as unknown as { _bookingDb?: Database.Database };
const db = globalForDb._bookingDb ?? createDb();
globalForDb._bookingDb = db;

export default db;

export interface Host {
  id: number;
  email: string;
  name: string;
  slug: string;
  password_hash: string;
  timezone: string;
  api_token: string;
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
  guest_timezone: string;
  notes: string;
  start_utc: string;
  end_utc: string;
  status: string;
  cancel_token: string;
  ms_event_id: string | null;
  created_at: string;
}
