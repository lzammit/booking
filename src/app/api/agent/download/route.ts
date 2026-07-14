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

function installScript(appUrl: string, token: string): string {
  return `#!/bin/bash
# BookingAgent installer — personalized for your account.
set -e
cd "$(dirname "$0")"

CONF_DIR="$HOME/Library/Application Support/BookingAgent"
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/config.json" <<EOF
{ "appUrl": "${appUrl}", "token": "${token}", "days": 60 }
EOF
chmod 600 "$CONF_DIR/config.json"

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/BookingAgent.app"
ditto BookingAgent.app "$HOME/Applications/BookingAgent.app"
xattr -dr com.apple.quarantine "$HOME/Applications/BookingAgent.app" 2>/dev/null || true

open "$HOME/Applications/BookingAgent.app"
echo
echo "BookingAgent installed. Click Allow when macOS asks for Calendar access."
echo "Look for the calendar icon in your menu bar."
`;
}

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
  const zip = new AdmZip(BASE_ZIP);
  const name = "Install BookingAgent.command";
  zip.addFile(name, Buffer.from(installScript(appUrl, host.api_token), "utf-8"));
  // addFile's attr param gets mangled; set the mode on the header so the
  // script extracts executable and Finder can run it.
  zip.getEntry(name)!.header.attr = (0o100755 << 16) >>> 0;

  return new NextResponse(new Uint8Array(zip.toBuffer()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="BookingAgent.zip"',
      "Cache-Control": "no-store",
    },
  });
}
