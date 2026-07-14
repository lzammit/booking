<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project notes

Calendly-style booking app. Source lives on the Mac; deploys to the `calendar` Linode
(`rsync` to /opt/booking/app, build + `systemctl restart booking` via `cc-run` in the
user's tmux). Live at https://booking.packetfence.net.

## Design system ("circadian" identity — public pages)

The signature: time of day is encoded as color. Every slot/time reference is tinted
along a circadian scale by its local hour (see `circadian()` in BookingWidget.tsx),
and the `.day-arc` gradient strip (dawn→noon→dusk) is the recurring brand mark.
Spend color ONLY on time; everything else stays ink on paper.

- Colors (globals.css tokens): ink #1C2333, paper #FBFAF7, dawn #F0987E (06:00),
  noon #EDBE4B (12:00), dusk #7C6FD9 (20:00). Actions are solid ink; focus ring dusk.
- Type: Space Grotesk (display/body, via --font-grotesk), IBM Plex Mono for times,
  dates, eyebrows, and labels (tabular-nums; uppercase tracking-[0.15em]–[0.2em]).
- Shape: rounded-lg/xl/2xl cards, border-ink/10, white cards on paper background.
- Motion: slots cascade in (.slot-cascade, 28ms stagger); prefers-reduced-motion off
  switch is in globals.css. Keep motion to that one moment.
- The dashboard stays utilitarian; the identity applies to guest-facing pages
  (/, /book/*, /cancel/*).
