import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { webexAuthUrl, webexConfigured } from "@/lib/webex";

export async function GET() {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const host = await currentHost();
  if (!host) return NextResponse.redirect(new URL("/login", appUrl));
  if (!webexConfigured()) {
    return NextResponse.json({ error: "Webex integration not configured" }, { status: 503 });
  }
  const state = randomBytes(16).toString("hex");
  const session = await getSession();
  (session as unknown as { webexState?: string }).webexState = state;
  await session.save();
  return NextResponse.redirect(webexAuthUrl(state));
}
