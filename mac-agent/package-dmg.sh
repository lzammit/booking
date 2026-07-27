#!/usr/bin/env bash
# Build BookingAgent.app and wrap it in a drag-to-install .dmg.
# Output: BookingAgent.dmg (a compressed disk image with the app + an
# /Applications shortcut, so users drag the app onto Applications).
set -euo pipefail
cd "$(dirname "$0")"

./build.sh

VOL="Booking Agent"
DMG="BookingAgent.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R BookingAgent.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "$VOL" \
  -srcfolder "$STAGE" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$DMG" >/dev/null

# Sign the disk image with the same identity as the app (best effort).
codesign -s "Apple Development: luzammi@akamai.com" "$DMG" 2>/dev/null || true

echo "Built $PWD/$DMG"
