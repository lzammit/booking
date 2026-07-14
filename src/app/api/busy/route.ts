import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db, { Host } from "@/lib/db";

/**
 * Receives busy intervals from a local calendar agent (e.g. the Mac EventKit
 * agent). Each push replaces all previously stored intervals for that
 * host+source, so the agent always sends its full sync window.
 */

const busySchema = z.object({
  source: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  intervals: z
    .array(z.object({ start: z.string(), end: z.string() }))
    .max(5000),
});

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const host = db
    .prepare("SELECT * FROM hosts WHERE api_token = ?")
    .get(token) as Host | undefined;
  if (!host) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let input;
  try {
    input = busySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const rows: { start: string; end: string }[] = [];
  for (const iv of input.intervals) {
    const start = DateTime.fromISO(iv.start, { zone: "utc" });
    const end = DateTime.fromISO(iv.end, { zone: "utc" });
    if (!start.isValid || !end.isValid || end <= start) {
      return NextResponse.json({ error: `Invalid interval ${iv.start}` }, { status: 400 });
    }
    rows.push({ start: start.toISO()!, end: end.toISO()! });
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM external_busy WHERE host_id = ? AND source = ?").run(
      host.id,
      input.source
    );
    const ins = db.prepare(
      "INSERT INTO external_busy (host_id, source, start_utc, end_utc) VALUES (?, ?, ?, ?)"
    );
    for (const r of rows) ins.run(host.id, input.source, r.start, r.end);
    // Heartbeat: recorded even when the calendar has no busy blocks, so the
    // dashboard can tell "agent alive" from "agent gone".
    db.prepare(
      `INSERT INTO agent_syncs (host_id, source, last_sync, blocks)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(host_id, source) DO UPDATE SET last_sync=datetime('now'), blocks=excluded.blocks`
    ).run(host.id, input.source, rows.length);
  });
  tx();

  return NextResponse.json({ ok: true, stored: rows.length });
}
