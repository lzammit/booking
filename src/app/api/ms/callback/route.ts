import { NextRequest, NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { msExchangeCode } from "@/lib/msgraph";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small HTML page that closes the popup and refreshes the Settings tab. */
function popupClose(status: "connected" | "error", message?: string): NextResponse {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const fallback = `${appUrl}/dashboard/settings?ms=${status}`;
  const body = `<!doctype html><meta charset="utf-8"><title>Microsoft 365</title>
<body style="font-family:system-ui;padding:2rem;color:#1c2333;background:#fbfaf7">
<p>${status === "connected" ? "Microsoft 365 connected. You can close this window." : "Microsoft 365 connection failed" + (message ? ": " + escapeHtml(message) : "") + "."}</p>
<script>
  try {
    if (window.opener) { window.opener.location.href = ${JSON.stringify(fallback)}; window.close(); }
    else { window.location.href = ${JSON.stringify(fallback)}; }
  } catch (e) { window.location.href = ${JSON.stringify(fallback)}; }
</script>
</body>`;
  return new NextResponse(body, {
    status: status === "connected" ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const host = await currentHost();
  if (!host) return popupClose("error", "not logged in");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorDesc = req.nextUrl.searchParams.get("error_description");
  const session = await getSession();
  const expected = (session as unknown as { msState?: string }).msState;
  (session as unknown as { msState?: string }).msState = undefined;
  await session.save();

  if (errorDesc || !code || !state || !expected || state !== expected) {
    console.error("MS OAuth callback error:", errorDesc || "state mismatch");
    return popupClose("error", errorDesc || "authorization was denied");
  }
  try {
    await msExchangeCode(host.id, code);
  } catch (err) {
    console.error("MS code exchange failed:", err);
    return popupClose("error", "token exchange failed");
  }
  return popupClose("connected");
}
