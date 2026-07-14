#!/usr/bin/env bash
# Install BookingAgent.app to ~/Applications and launch it.
# First launch asks for the server URL + API token; the app then syncs every
# 5 minutes and starts itself at login. No launchd setup needed.
set -euo pipefail
cd "$(dirname "$0")"

./build.sh

# Remove the old CLI-era launchd job if present.
OLD_PLIST="$HOME/Library/LaunchAgents/com.luzammi.booking-agent.plist"
if [ -f "$OLD_PLIST" ]; then
  launchctl unload "$OLD_PLIST" 2>/dev/null || true
  rm -f "$OLD_PLIST"
fi

DEST="$HOME/Applications/BookingAgent.app"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R BookingAgent.app "$DEST"

open "$DEST"
echo "BookingAgent is running — look for the calendar icon in the menu bar."
