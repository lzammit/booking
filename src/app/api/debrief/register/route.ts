import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSetting, setSetting } from "@/lib/db";

/**
 * One-time (repeatable) registration for the MeetingDebrief iPhone companion.
 * Gated by a server-side setup code so random callers can't create/overwrite
 * the credential. The password never leaves the device in the clear beyond
 * this HTTPS POST; only its bcrypt hash is stored.
 *
 *   POST /api/debrief/register  { setupCode, username, password }  -> { ok }
 *
 * Re-registering with a valid setup code overwrites the credential — this is
 * also the password-reset path. The setup code lives in the DEBRIEF_SETUP_CODE
 * environment variable.
 */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const setupCode = process.env.DEBRIEF_SETUP_CODE;
  if (!setupCode) {
    return NextResponse.json({ error: "Registration not configured" }, { status: 503 });
  }

  let body: { setupCode?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const provided = body.setupCode || "";
  if (!constantTimeEqual(provided, setupCode)) {
    return NextResponse.json({ error: "Invalid setup code" }, { status: 401 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  if (username.length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const hash = bcrypt.hashSync(password, 10);
  setSetting("debrief_login_user", username);
  setSetting("debrief_login_pass_hash", hash);

  const existed = !!getSetting("debrief_login_user");
  return NextResponse.json({ ok: true, updated: existed });
}
