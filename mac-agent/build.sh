#!/usr/bin/env bash
# Build BookingAgent.app — a minimal bundle so macOS attributes the Calendar
# permission to the agent itself (bare CLI binaries get silently denied under launchd).
set -euo pipefail
cd "$(dirname "$0")"

APP=BookingAgent.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

swiftc -O -o "$APP/Contents/MacOS/booking-agent" BookingAgent.swift

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.luzammi.booking-agent</string>
    <key>CFBundleName</key><string>BookingAgent</string>
    <key>CFBundleExecutable</key><string>booking-agent</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSUIElement</key><true/>
    <key>NSCalendarsUsageDescription</key>
    <string>Reads your calendar busy times to block them on your booking page, and adds new bookings to your calendar.</string>
    <key>NSCalendarsFullAccessUsageDescription</key>
    <string>Reads your calendar busy times to block them on your booking page, and adds new bookings to your calendar.</string>
</dict>
</plist>
EOF

# Prefer a stable signing identity: TCC ties the calendar permission to the
# signature, and ad-hoc signatures change every build.
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development/ {print $2; exit}')
if [ -n "$IDENTITY" ]; then
  codesign --force --deep -s "$IDENTITY" "$APP"
  echo "Signed with: $IDENTITY"
else
  codesign --force --deep -s - "$APP"
fi
echo "Built $PWD/$APP"
