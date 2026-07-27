#!/usr/bin/env bash
# Build BookingAgent.app and wrap it in a drag-to-install .dmg.
# With a Developer ID signature, the app + dmg are notarized and stapled so
# they open with no Gatekeeper prompt. Output: BookingAgent.dmg.
#
# Notarization uses a stored notarytool keychain profile (default: "notary").
# Set NOTARY_PROFILE to use a different one, or leave unset to skip notarizing.
set -euo pipefail
cd "$(dirname "$0")"

./build.sh

VOL="Booking Agent"
DMG="BookingAgent.dmg"
NOTARY_PROFILE="${NOTARY_PROFILE:-notary}"

# Notarize the app first (best effort — skip cleanly if no profile is set up).
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "Notarizing app…"
  APPZIP="$(mktemp -d)/BookingAgent.app.zip"
  ditto -c -k --keepParent BookingAgent.app "$APPZIP"
  xcrun notarytool submit "$APPZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple BookingAgent.app
  rm -f "$APPZIP"
else
  echo "No notarytool profile '$NOTARY_PROFILE' — building an un-notarized dmg."
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R BookingAgent.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "$VOL" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null

# Sign, notarize, and staple the disk image itself.
DEVID=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/ {print $2; exit}')
if [ -n "$DEVID" ]; then
  codesign --force -s "$DEVID" --timestamp "$DMG"
  if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "Notarizing dmg…"
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
fi

echo "Built $PWD/$DMG"