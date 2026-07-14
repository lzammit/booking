import fs from "fs";
import AdmZip from "adm-zip";
import { NextRequest, NextResponse } from "next/server";
import db, { Host } from "@/lib/db";
import { currentHost } from "@/lib/session";

/**
 * Personalized Mac agent download: the prebuilt BookingAgent.app plus an
 * install script pre-filled with the requesting host's API token.
 * Auth: dashboard session, or ?token=<api_token> for CLI use.
 */

const BASE_ZIP =
  process.env.AGENT_ZIP || "/opt/booking/agent/BookingAgent.app.zip";

export async function GET(req: NextRequest) {
  let host = await currentHost();
  if (!host) {
    const token = req.nextUrl.searchParams.get("token");
    if (token) {
      host = db.prepare("SELECT * FROM hosts WHERE api_token = ?").get(token) as
        | Host
        | undefined ?? null;
    }
  }
  if (!host) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  if (!fs.existsSync(BASE_ZIP)) {
    return NextResponse.json(
      { error: "Agent package not available on this server" },
      { status: 404 }
    );
  }

  const appUrl = process.env.APP_URL || `https://${req.nextUrl.host}`;
  // Sidecar config next to the app: the agent imports it on first launch,
  // so the download is install-and-go with no manual token entry.
  const zip = new AdmZip(BASE_ZIP);
  const name = "booking-config.json";
  zip.addFile(
    name,
    Buffer.from(
      JSON.stringify({ appUrl, token: host.api_token, days: 60 }),
      "utf-8"
    )
  );
  // addFile's attr param gets mangled; set the mode on the header.
  zip.getEntry(name)!.header.attr = (0o100644 << 16) >>> 0;

  return new NextResponse(new Uint8Array(zip.toBuffer()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="BookingAgent.zip"',
      "Cache-Control": "no-store",
    },
  });
}
