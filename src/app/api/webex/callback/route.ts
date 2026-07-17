import { NextRequest, NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { webexExchangeCode } from "@/lib/webex";

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const host = await currentHost();
  if (!host) return NextResponse.redirect(new URL("/login", appUrl));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorDesc = req.nextUrl.searchParams.get("error_description");
  const session = await getSession();
  const expected = (session as unknown as { webexState?: string }).webexState;
  (session as unknown as { webexState?: string }).webexState = undefined;
  await session.save();

  if (errorDesc || !code || !state || !expected || state !== expected) {
    console.error("Webex OAuth callback error:", errorDesc || "state mismatch");
    return NextResponse.redirect(new URL("/dashboard/settings?webex=error", appUrl));
  }
  try {
    await webexExchangeCode(host.id, code);
  } catch (err) {
    console.error("Webex code exchange failed:", err);
    return NextResponse.redirect(new URL("/dashboard/settings?webex=error", appUrl));
  }
  return NextResponse.redirect(new URL("/dashboard/settings?webex=connected", appUrl));
}
