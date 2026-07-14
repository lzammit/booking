"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Client-side booking flow: month calendar → time slots → details form → done.
 * Slots arrive as UTC ISO strings; all display is in the guest's browser timezone.
 */

interface Props {
  eventTypeId: number;
  durationMin: number;
  windowDays: number;
  hostName: string;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingWidget({ eventTypeId, durationMin, hostName }: Props) {
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
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

  // Fetch all slots for the visible month.
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
      setError("Could not load availability. Try again.");
      setSlots([]);
    }
  }, [eventTypeId, monthStart]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  // Group slots by guest-local day.
  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const iso of slots ?? []) {
      const day = ymd(new Date(iso));
      const list = map.get(day) ?? [];
      list.push(iso);
      map.set(day, list);
    }
    return map;
  }, [slots]);

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

  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

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
      // Slot may have been taken meanwhile; refresh.
      loadMonth();
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 space-y-2">
        <h2 className="text-xl font-semibold text-green-800">You’re booked ✓</h2>
        <p className="text-green-800">
          {new Date(confirmed.start).toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          ({tz}) with {hostName}, {durationMin} minutes.
        </p>
        <p className="text-sm text-green-700">
          A confirmation email with a calendar invite is on its way.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_260px]">
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() =>
              setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))
            }
            className="rounded-lg border border-gray-300 px-3 py-1 hover:bg-gray-50"
            aria-label="Previous month"
          >
            ←
          </button>
          <div className="font-semibold">{monthLabel}</div>
          <button
            type="button"
            onClick={() =>
              setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))
            }
            className="rounded-lg border border-gray-300 px-3 py-1 hover:bg-gray-50"
            aria-label="Next month"
          >
            →
          </button>
        </div>
        <table className="w-full text-center text-sm">
          <thead>
            <tr className="text-gray-400">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <th key={d} className="pb-2 font-normal">
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
                          className={`h-10 w-10 rounded-full ${
                            selectedDay === day
                              ? "bg-blue-600 text-white"
                              : available
                                ? "bg-blue-50 text-blue-700 font-medium hover:bg-blue-100"
                                : "text-gray-300"
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
        {slots === null && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
        <p className="mt-3 text-xs text-gray-400">Times shown in {tz}</p>
      </div>

      <div>
        {selectedDay && !selectedSlot && (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">
              {new Date(selectedDay + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {(slotsByDay.get(selectedDay) ?? []).map((iso) => (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedSlot(iso)}
                  className="w-full rounded-lg border border-blue-300 px-3 py-2 text-blue-700 font-medium hover:bg-blue-50"
                >
                  {timeLabel(iso)}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedSlot && (
          <form onSubmit={submit} className="space-y-3">
            <h3 className="font-semibold text-sm">
              {new Date(selectedSlot).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </h3>
            <input
              name="name"
              required
              placeholder="Your name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="Your email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              name="notes"
              rows={3}
              placeholder="Anything to share? (optional)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Booking…" : "Confirm booking"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
              >
                Back
              </button>
            </div>
          </form>
        )}

        {!selectedDay && (
          <p className="text-sm text-gray-400 pt-8">Select a highlighted day to see times.</p>
        )}
      </div>
    </div>
  );
}
