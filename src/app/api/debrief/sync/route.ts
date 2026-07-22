import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

/**
 * Text-only sync bridge for the MeetingDebrief Mac app and its iPhone
 * companion. Completely separate from the booking app: its own token
 * (DEBRIEF_SYNC_TOKEN), one JSON blob on disk, no database, no audio.
 *
 *   POST /api/debrief/sync   Mac uploads the latest bundle (Bearer token)
 *   GET  /api/debrief/sync   iPhone (or Mac) downloads it (Bearer token)
 *
 * Cross-Apple-ID friendly by design — it's a plain HTTPS endpoint, not iCloud.
 */

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const blobPath = path.join(dataDir, "debrief-sync.json");
const MAX_BYTES = 64 * 1024 * 1024; // 64 MB — text (incl. transcripts) for all meetings

function authorized(req: NextRequest): boolean {
  const token = process.env.DEBRIEF_SYNC_TOKEN;
  if (!token) return false; // not configured → refuse everything
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Constant-time-ish compare.
  if (provided.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.text();
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    JSON.parse(body); // reject non-JSON
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(blobPath, body, "utf8");
  return NextResponse.json({ ok: true, bytes: body.length });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body = "{}";
  try {
    body = fs.readFileSync(blobPath, "utf8");
  } catch {
    // No bundle uploaded yet — return an empty one.
    body = JSON.stringify({ generatedAt: null, meetings: [] });
  }
  return new NextResponse(body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
