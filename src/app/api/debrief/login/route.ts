import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSetting } from "@/lib/db";

/**
 * Dedicated login for the MeetingDebrief iPhone companion. Separate from the
 * booking app's host accounts. Credentials are created via
 * POST /api/debrief/register and stored in the settings table
 * (debrief_login_user / debrief_login_pass_hash). On success it hands back the
 * sync bearer token, which the app stores and uses for GET /api/debrief/sync.
 *
 *   POST /api/debrief/login   { username, password }  ->  { token }
 */

// A fixed dummy hash so a bad username costs the same time as a bad password
// (blunts username enumeration via timing).
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8Dq.EAsQ.G1QxV0mQ2Q3zQ2Q3zQ2Q";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const user = getSetting("debrief_login_user");
  const hash = getSetting("debrief_login_pass_hash");
  const token = process.env.DEBRIEF_SYNC_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Sync not configured" }, { status: 503 });
  }
  if (!user || !hash) {
    return NextResponse.json({ error: "No account yet — register first" }, { status: 409 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  // Always run bcrypt (against a dummy hash on username mismatch) so the
  // response time doesn't reveal whether the username exists.
  const userOK = constantTimeEqual(username, user);
  const passOK = await bcrypt.compare(password, userOK ? hash : DUMMY_HASH);

  if (!userOK || !passOK) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  return NextResponse.json({ token });
}
