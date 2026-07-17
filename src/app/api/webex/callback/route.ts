import { NextRequest, NextResponse } from "next/server";
import { currentHost, getSession } from "@/lib/session";
import { webexExchangeCode } from "@/lib/webex";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small HTML page that closes the popup and refreshes the Settings tab. */
function popupClose(status: "connected" | "error", message?: string): NextResponse {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const fallback = `${appUrl}/dashboard/settings?webex=${status}`;
  const body = `<!doctype html><meta charset="utf-8"><title>Webex</title>
<body style="font-family:system-ui;padding:2rem;color:#1c2333;background:#fbfaf7">
<p>${status === "connected" ? "Webex connected. You can close this window." : "Webex connection failed" + (message ? ": " + escapeHtml(message) : "") + "."}</p>
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
  const expected = (session as unknown as { webexState?: string }).webexState;
  (session as unknown as { webexState?: string }).webexState = undefined;
  await session.save();

  if (errorDesc || !code || !state || !expected || state !== expected) {
    console.error("Webex OAuth callback error:", errorDesc || "state mismatch");
    return popupClose("error", errorDesc || "authorization was denied");
  }
  try {
    await webexExchangeCode(host.id, code);
  } catch (err) {
    console.error("Webex code exchange failed:", err);
    return popupClose("error", "token exchange failed");
  }
  return popupClose("connected");
}
