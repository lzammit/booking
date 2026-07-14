import { DateTime, Interval } from "luxon";
import db, { AvailabilityRule, Booking, EventType, Host } from "./db";
import { getBusyIntervals } from "./msgraph";

/**
 * Compute available slot start times (UTC ISO strings) for an event type
 * between two dates (inclusive, interpreted in the host's timezone).
 */
export async function computeSlots(
  host: Host,
  eventType: EventType,
  fromDate: string, // yyyy-MM-dd
  toDate: string
): Promise<string[]> {
  const zone = host.timezone;
  const now = DateTime.utc();
  const earliestStart = now.plus({ minutes: eventType.min_notice_min });
  const latestStart = now.plus({ days: eventType.window_days });

  let from = DateTime.fromISO(fromDate, { zone }).startOf("day");
  let to = DateTime.fromISO(toDate, { zone }).endOf("day");
  if (!from.isValid || !to.isValid) return [];
  // Never compute more than ~2 months at a time.
  if (to.diff(from, "days").days > 62) to = from.plus({ days: 62 });

  const rules = db
    .prepare("SELECT * FROM availability_rules WHERE host_id = ?")
    .all(host.id) as AvailabilityRule[];
  if (rules.length === 0) return [];
  const rulesByWeekday = new Map<number, AvailabilityRule[]>();
  for (const r of rules) {
    const list = rulesByWeekday.get(r.weekday) ?? [];
    list.push(r);
    rulesByWeekday.set(r.weekday, list);
  }

  // Busy intervals: confirmed bookings (any event type of this host) + M365 calendar.
  const bookings = db
    .prepare(
      "SELECT * FROM bookings WHERE host_id = ? AND status = 'confirmed' AND end_utc > ? AND start_utc < ?"
    )
    .all(host.id, from.toUTC().toISO(), to.toUTC().toISO()) as Booking[];
  const busy: Interval[] = bookings.map((b) =>
    Interval.fromDateTimes(
      DateTime.fromISO(b.start_utc),
      DateTime.fromISO(b.end_utc)
    )
  );
  busy.push(...(await getBusyIntervals(host.id, from.toUTC(), to.toUTC())));

  const durationMin = eventType.duration_min;
  const bufferMin = eventType.buffer_min;
  const slots: string[] = [];

  for (let day = from; day <= to; day = day.plus({ days: 1 })) {
    const dayRules = rulesByWeekday.get(day.weekday) ?? [];
    for (const rule of dayRules) {
      for (
        let startMin = rule.start_min;
        startMin + durationMin <= rule.end_min;
        startMin += durationMin
      ) {
        const slotStart = day.plus({ minutes: startMin });
        const slotEnd = slotStart.plus({ minutes: durationMin });
        if (slotStart < earliestStart || slotStart > latestStart) continue;
        // Buffer pads the slot on both sides when checking conflicts.
        const padded = Interval.fromDateTimes(
          slotStart.minus({ minutes: bufferMin }),
          slotEnd.plus({ minutes: bufferMin })
        );
        if (busy.some((b) => b.overlaps(padded))) continue;
        const iso = slotStart.toUTC().toISO();
        if (iso) slots.push(iso);
      }
    }
  }
  return slots.sort();
}

/** Re-check that a specific slot is still free right before booking. */
export async function isSlotFree(
  host: Host,
  eventType: EventType,
  startUtcISO: string
): Promise<boolean> {
  const start = DateTime.fromISO(startUtcISO, { zone: "utc" });
  if (!start.isValid) return false;
  const day = start.setZone(host.timezone).toISODate();
  if (!day) return false;
  const slots = await computeSlots(host, eventType, day, day);
  const normalized = start.toISO();
  return slots.some((s) => s === normalized);
}
