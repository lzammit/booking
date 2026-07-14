import { NextRequest, NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { msExchangeCode } from "@/lib/msgraph";

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const host = await currentHost();
  if (!host) return NextResponse.redirect(new URL("/login", appUrl));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorDesc = req.nextUrl.searchParams.get("error_description");
  const session = await getSession();
  const expected = (session as unknown as { msState?: string }).msState;
  (session as unknown as { msState?: string }).msState = undefined;
  await session.save();

  if (errorDesc || !code || !state || !expected || state !== expected) {
    console.error("MS OAuth callback error:", errorDesc || "state mismatch");
    return NextResponse.redirect(new URL("/dashboard?ms=error", appUrl));
  }
  try {
    await msExchangeCode(host.id, code);
  } catch (err) {
    console.error("MS code exchange failed:", err);
    return NextResponse.redirect(new URL("/dashboard?ms=error", appUrl));
  }
  return NextResponse.redirect(new URL("/dashboard?ms=connected", appUrl));
}
