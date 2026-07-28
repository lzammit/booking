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
    <key>CFBundleShortVersionString</key><string>1.1</string>
    <key>LSUIElement</key><true/>
    <key>NSCalendarsUsageDescription</key>
    <string>Reads your calendar busy times to block them on your booking page, and adds new bookings to your calendar.</string>
    <key>NSCalendarsFullAccessUsageDescription</key>
    <string>Reads your calendar busy times to block them on your booking page, and adds new bookings to your calendar.</string>
</dict>
</plist>
EOF

# Signing identity. TCC ties the calendar permission to the signature, and
# ad-hoc signatures change every build. Prefer "Developer ID Application"
# (required for notarized distribution); fall back to Apple Development (local
# use), then ad-hoc. Developer ID builds add the hardened runtime + a secure
# timestamp so the app can be notarized.
DEVID=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ {print $2; exit}')
APPLEDEV=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development/ {print $2; exit}')
if [ -n "$DEVID" ]; then
  codesign --force --options runtime --timestamp -s "$DEVID" "$APP"
  echo "Signed with: $DEVID (hardened runtime, timestamped)"
elif [ -n "$APPLEDEV" ]; then
  codesign --force -s "$APPLEDEV" "$APP"
  echo "Signed with: $APPLEDEV"
else
  codesign --force -s - "$APP"
  echo "Signed ad-hoc"
fi
echo "Built $PWD/$APP"
