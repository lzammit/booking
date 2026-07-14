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
    <string>Reads your calendar busy times to block them on your booking page.</string>
    <key>NSCalendarsFullAccessUsageDescription</key>
    <string>Reads your calendar busy times to block them on your booking page.</string>
</dict>
</plist>
EOF

codesign --force --deep -s - "$APP"
echo "Built $PWD/$APP"
