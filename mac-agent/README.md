# BookingAgent (macOS companion app)

A menu-bar app that keeps a host's Mac calendar in sync with the Booking server,
every 5 minutes and in both directions:

- **Pushes busy times up** — reads the next ~60 days from the Mac's calendars and
  posts *only start/end intervals* (no titles, attendees, or locations) to
  `POST /api/busy`, so people can't book over existing commitments. Optionally
  also relays a published Outlook ICS feed as a second busy source.
- **Pulls bookings down** — `GET /api/agent/bookings`, reconciling them into the
  local Calendar via EventKit (create / update / remove). This is how bookings
  reach the calendar when email invites are stripped by corporate mail systems.

It authenticates with the host's API token (from the dashboard → Settings).
Config lives at `~/Library/Application Support/BookingAgent/config.json`.

## Build

Requires Xcode command-line tools (`swiftc`).

```bash
./build.sh      # compiles BookingAgent.swift into BookingAgent.app
./install.sh    # builds (if needed), installs to ~/Applications, launches
```

`build.sh` produces `BookingAgent.app` (a ~260 KB bundle). It is a build
artifact and is not committed — build it from `BookingAgent.swift` (the single
source file) as needed.

## Distribution

The server serves a prebuilt, per-host-personalized zip via
`/api/agent/download` (Settings → "Download Mac agent"). To refresh what the
server hands out after changing the source:

```bash
./build.sh
ditto -c -k --keepParent BookingAgent.app BookingAgent.app.zip
# copy BookingAgent.app.zip to the server's AGENT_ZIP path
```

## Notes

- The app is signed with a local/ad-hoc certificate. On a managed Mac, first
  launch may be blocked by Gatekeeper; clear the quarantine flag with
  `xattr -dr com.apple.quarantine <path-to>/BookingAgent.app`, or use an Apple
  Developer ID + notarization to remove the step entirely.
- Rebuilding changes the code signature, which can make macOS re-prompt for
  Calendar access on next launch.
