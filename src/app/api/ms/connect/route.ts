import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { msAuthUrl, msConfigured } from "@/lib/msgraph";

export async function GET() {
  const host = await currentHost();
  if (!host) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));
  if (!msConfigured()) {
    return NextResponse.json({ error: "Microsoft integration not configured" }, { status: 503 });
  }
  const state = randomBytes(16).toString("hex");
  const session = await getSession();
  (session as unknown as { msState?: string }).msState = state;
  await session.save();
  return NextResponse.redirect(msAuthUrl(state));
}
