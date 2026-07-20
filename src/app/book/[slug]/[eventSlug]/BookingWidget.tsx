"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Client-side booking flow: month calendar → time slots → details form → done.
 * Slots arrive as UTC ISO strings; all display is in the guest's browser timezone.
 *
 * Signature design element: each slot is tinted by its hour along a circadian
 * scale (dawn coral → noon gold → dusk violet), so time of day is visible
 * before the numbers are read.
 */

interface Props {
  eventTypeId: number;
  durationMin: number;
  windowDays: number;
  hostName: string;
  hostTimezone: string;
}

const DAWN: [number, number, number] = [240, 152, 126]; // 06:00
const NOON: [number, number, number] = [237, 190, 75]; // 12:00
const DUSK: [number, number, number] = [124, 111, 217]; // 20:00

function circadian(hourDecimal: number): string {
  const h = Math.min(20, Math.max(6, hourDecimal));
  const [from, to, t] =
    h <= 12
      ? [DAWN, NOON, (h - 6) / 6]
      : [NOON, DUSK, (h - 12) / 8];
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Date + clock parts of a UTC instant, as seen in a given IANA timezone. */
function zonedParts(iso: string, tz: string): { ymd: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export default function BookingWidget({
  eventTypeId,
  durationMin,
  hostName,
  hostTimezone,
}: Props) {
  const browserTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [tz, setTz] = useState(browserTz);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [...new Set([browserTz, hostTimezone, "UTC"])];
    }
  }, [browserTz, hostTimezone]);
  const today = useMemo(() => new Date(), []);
  const [monthStart, setMonthStart] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [slots, setSlots] = useState<string[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ start: string } | null>(null);

  const loadMonth = useCallback(async () => {
    setSlots(null);
    const from = ymd(monthStart);
    const to = ymd(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    try {
      const res = await fetch(
        `/api/slots?eventTypeId=${eventTypeId}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { slots: string[] };
      setSlots(data.slots);
    } catch {
      setError("Availability didn’t load. Try again in a moment.");
      setSlots([]);
    }
  }, [eventTypeId, monthStart]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const iso of slots ?? []) {
      const day = zonedParts(iso, tz).ymd;
      const list = map.get(day) ?? [];
      list.push(iso);
      map.set(day, list);
    }
    return map;
  }, [slots, tz]);

  // Land the visitor on the first day that has availability (like Calendly),
  // rather than an empty "choose a day" state — but don't override a choice
  // they've already made or a month they've navigated to on purpose.
  useEffect(() => {
    if (selectedDay || selectedSlot || slots === null) return;
    const firstOpen = [...slotsByDay.keys()].sort()[0];
    if (firstOpen) setSelectedDay(firstOpen);
  }, [slots, slotsByDay, selectedDay, selectedSlot]);

  const monthLabel = monthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const weeks = useMemo(() => {
    const first = new Date(monthStart);
    const startWeekday = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0
    ).getDate();
    const cells: (string | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(ymd(new Date(monthStart.getFullYear(), monthStart.getMonth(), d)));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [monthStart]);

  const timeLabel = (iso: string, zone: string = tz) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    });

  const slotColor = (iso: string) => {
    const p = zonedParts(iso, tz);
    return circadian(p.hour + p.minute / 60);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventTypeId,
          start: selectedSlot,
          name: fd.get("name"),
          company: fd.get("company"),
          email: fd.get("email"),
          notes: fd.get("notes") || "",
          timezone: tz,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      setConfirmed({ start: selectedSlot });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
      loadMonth();
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    const c = slotColor(confirmed.start);
    return (
      <div className="max-w-md rounded-2xl border border-ink/10 bg-white p-8">
        <div className="day-arc w-full" />
        <h2 className="mt-6 text-2xl font-semibold text-ink">You’re booked.</h2>
        <p className="mt-3 flex items-center gap-2 font-mono text-sm text-ink">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: c }}
          />
          {new Date(confirmed.start).toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: tz,
          })}
        </p>
        {tz !== hostTimezone && (
          <p className="mt-1 font-mono text-xs text-ink/50">
            = {timeLabel(confirmed.start, hostTimezone)} for {hostName} ({hostTimezone})
          </p>
        )}
        <p className="mt-2 text-sm text-ink/60">
          {durationMin} minutes with {hostName}, shown in {tz}. A confirmation
          email with a calendar invite is on its way.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-10 md:grid-cols-[1fr_280px]">
      <div>
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() =>
              setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))
            }
            className="h-9 w-9 rounded-full border border-ink/15 text-ink hover:bg-ink hover:text-paper transition"
            aria-label="Previous month"
          >
            ←
          </button>
          <div className="font-mono text-sm font-medium uppercase tracking-[0.15em] text-ink">
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() =>
              setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))
            }
            className="h-9 w-9 rounded-full border border-ink/15 text-ink hover:bg-ink hover:text-paper transition"
            aria-label="Next month"
          >
            →
          </button>
        </div>
        <table className="w-full text-center text-sm">
          <thead>
            <tr className="font-mono text-[11px] uppercase text-ink/40">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <th key={d} className="pb-3 font-normal">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  const available = day ? (slotsByDay.get(day)?.length ?? 0) > 0 : false;
                  return (
                    <td key={di} className="p-1">
                      {day && (
                        <button
                          type="button"
                          disabled={!available}
                          onClick={() => {
                            setSelectedDay(day);
                            setSelectedSlot(null);
                          }}
                          className={`h-10 w-10 rounded-full font-mono tabular-nums transition ${
                            selectedDay === day
                              ? "bg-ink text-paper"
                              : available
                                ? "text-ink ring-1 ring-inset ring-ink/25 hover:ring-ink hover:bg-white"
                                : "text-ink/20"
                          }`}
                        >
                          {Number(day.slice(-2))}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {slots === null && (
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.15em] text-ink/40">
            Loading availability…
          </p>
        )}
        <label className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs text-ink/40">
          Times shown in
          <select
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              // Day boundaries shift with the zone — re-pick the first open day.
              setSelectedDay(null);
              setSelectedSlot(null);
            }}
            className="max-w-full rounded-lg border border-ink/15 bg-white px-2 py-1 font-mono text-xs text-ink"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {tz !== hostTimezone && (
            <span className="text-ink/40">
              · {hostName}: {hostTimezone.replace(/_/g, " ")}
            </span>
          )}
        </label>
        <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-ink/50">
          <span className="h-2 w-2 rounded-full" style={{ background: circadian(8) }} />
          morning
          <span className="ml-3 h-2 w-2 rounded-full" style={{ background: circadian(12.5) }} />
          midday
          <span className="ml-3 h-2 w-2 rounded-full" style={{ background: circadian(17) }} />
          evening
        </div>
      </div>

      <div>
        {selectedDay && !selectedSlot && (
          <div>
            <h3 className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-ink/60">
              {new Date(selectedDay + "T12:00:00Z").toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </h3>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
              {(slotsByDay.get(selectedDay) ?? []).map((iso, i) => {
                const c = slotColor(iso);
                const differs = tz !== hostTimezone;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedSlot(iso)}
                    style={{ "--slot-i": i } as React.CSSProperties}
                    title={
                      differs
                        ? `${timeLabel(iso, hostTimezone)} for ${hostName}`
                        : undefined
                    }
                    className="slot-cascade group flex w-full items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-2.5 text-left font-mono text-sm tabular-nums text-ink transition hover:border-ink"
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full transition group-hover:scale-125"
                      style={{ background: c }}
                    />
                    {timeLabel(iso)}
                    {differs && (
                      <span className="ml-auto text-xs text-ink/35">
                        {timeLabel(iso, hostTimezone)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {tz !== hostTimezone && (
              <p className="mt-2 font-mono text-[11px] text-ink/40">
                Grey time = {hostName}&rsquo;s ({hostTimezone.replace(/_/g, " ")})
              </p>
            )}
          </div>
        )}

        {selectedSlot && (
          <form onSubmit={submit} className="space-y-3">
            <h3 className="flex items-center gap-2 font-mono text-sm font-medium text-ink">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: slotColor(selectedSlot) }}
              />
              {new Date(selectedSlot).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: tz,
              })}
            </h3>
            {tz !== hostTimezone && (
              <p className="font-mono text-xs text-ink/50">
                = {timeLabel(selectedSlot, hostTimezone)} for {hostName}
              </p>
            )}
            <input
              name="name"
              required
              placeholder="Your name"
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm placeholder:text-ink/35"
            />
            <input
              name="company"
              required
              placeholder="Company"
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm placeholder:text-ink/35"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="Your email"
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm placeholder:text-ink/35"
            />
            <textarea
              name="notes"
              rows={3}
              placeholder="Anything to share ahead of the meeting? (optional)"
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm placeholder:text-ink/35"
            />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Booking…" : "Confirm booking"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink hover:border-ink"
              >
                Back
              </button>
            </div>
          </form>
        )}

        {!selectedDay && (
          <p className="pt-10 text-sm text-ink/40">
            Choose an outlined day to see its times.
          </p>
        )}
      </div>
    </div>
  );
}
