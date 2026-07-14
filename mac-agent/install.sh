#!/usr/bin/env bash
# Install the BookingAgent: copies the app bundle to ~/Applications, writes the
# config, and loads a launchd agent that syncs every 5 minutes.
# Usage: ./install.sh <appUrl> <apiToken>
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="${1:?usage: ./install.sh <appUrl> <apiToken>}"
TOKEN="${2:?usage: ./install.sh <appUrl> <apiToken>}"

[ -d BookingAgent.app ] || ./build.sh

DEST="$HOME/Applications/BookingAgent.app"
CONF_DIR="$HOME/Library/Application Support/BookingAgent"
PLIST="$HOME/Library/LaunchAgents/com.luzammi.booking-agent.plist"

mkdir -p "$HOME/Applications" "$CONF_DIR" "$HOME/Library/LaunchAgents"
rm -rf "$DEST"
cp -R BookingAgent.app "$DEST"

cat > "$CONF_DIR/config.json" <<EOF
{ "appUrl": "$APP_URL", "token": "$TOKEN", "days": 60 }
EOF
chmod 600 "$CONF_DIR/config.json"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.luzammi.booking-agent</string>
    <key>ProgramArguments</key>
    <array><string>$DEST/Contents/MacOS/booking-agent</string></array>
    <key>StartInterval</key><integer>300</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>/tmp/booking-agent.log</string>
    <key>StandardErrorPath</key><string>/tmp/booking-agent.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. First run will prompt for Calendar access — click Allow."
echo "Log: /tmp/booking-agent.log"
