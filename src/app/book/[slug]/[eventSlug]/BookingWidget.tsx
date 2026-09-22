"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Locale, t } from "@/lib/i18n";

/**
 * Client-side booking flow: month calendar → time slots → details form → done.
 * Slots arrive as UTC ISO strings; all display is in the guest's browser timezone.
 *
 * Signature design element: each slot is tinted by its hour along a circadian
 * scale (dawn coral → noon gold → dusk violet), so time of day is visible
 * before the numbers are read.
 */

interface Props {
  /** A host's event type… */
  eventTypeId?: number;
  /** …or a team's (round-robin: the server assigns a free member). */
  teamEventTypeId?: number;
  durationMin: number;
  windowDays: number;
  hostName: string;
  hostTimezone: string;
  locale: Locale;
  /** Questions asked on the details form; answers ride along with the booking. */
  questions?: string[];
  /** When set, the widget moves an existing booking instead of creating one. */
  rescheduleToken?: string;
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
  teamEventTypeId,
  durationMin,
  hostName,
  hostTimezone,
  locale,
  questions = [],
  rescheduleToken,
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
  const [confirmed, setConfirmed] = useState<{ start: string; host?: string } | null>(
    null
  );
  const uid = useId();
  const formHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);

  // Focus follows the panel swap so keyboard and screen-reader users land on
  // the new step instead of staying on a button that has just unmounted.
  useEffect(() => {
    if (selectedSlot && !confirmed) formHeadingRef.current?.focus();
  }, [selectedSlot, confirmed]);
  useEffect(() => {
    if (confirmed) confirmHeadingRef.current?.focus();
  }, [confirmed]);

  const loadMonth = useCallback(async () => {
    setSlots(null);
    const from = ymd(monthStart);
    const to = ymd(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    try {
      const idParam = teamEventTypeId
        ? `teamEventTypeId=${teamEventTypeId}`
        : `eventTypeId=${eventTypeId}`;
      const res = await fetch(
        `/api/slots?${idParam}&from=${from}&to=${to}${rescheduleToken ? `&exclude=${encodeURIComponent(rescheduleToken)}` : ""}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { slots: string[] };
      setSlots(data.slots);
    } catch {
      setError(t(locale, "errLoad"));
      setSlots([]);
    }
  }, [eventTypeId, teamEventTypeId, monthStart, rescheduleToken]);

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

  const monthLabel = monthStart.toLocaleDateString(locale, {
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
    new Date(iso).toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    });

  const slotColor = (iso: string) => {
    const p = zonedParts(iso, tz);
    return circadian(p.hour + p.minute / 60);
  };

  const todayYmd = ymd(today);
  /** Full localized date for a yyyy-MM-dd calendar day (accessible names). */
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(day + "T12:00:00Z"));
  /** Full localized date + time of a slot in the chosen zone (accessible names). */
  const slotLabel = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(rescheduleToken ? "/api/reschedule" : "/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rescheduleToken
            ? { token: rescheduleToken, start: selectedSlot, timezone: tz, locale }
            : {
                ...(teamEventTypeId ? { teamEventTypeId } : { eventTypeId }),
                start: selectedSlot,
                name: fd.get("name"),
                company: fd.get("company"),
                email: fd.get("email"),
                notes: fd.get("notes") || "",
                answers: questions.map((_, i) => String(fd.get(`answer_${i}`) || "")),
                timezone: tz,
                locale,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        const known = data.code === "slot_taken" || data.code === "rate_limited";
        throw new Error(known ? t(locale, data.code) : data.error || t(locale, "errGeneric"));
      }
      setConfirmed({ start: selectedSlot, host: data.hostName });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errGeneric"));
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
        <h2
          ref={confirmHeadingRef}
          tabIndex={-1}
          className="mt-6 text-2xl font-semibold text-ink outline-none"
        >
          {t(locale, rescheduleToken ? "rescheduledTitle" : "booked")}
        </h2>
        <p className="mt-3 flex items-center gap-2 font-mono text-sm text-ink">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: c }}
          />
          {new Date(confirmed.start).toLocaleString(locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: tz,
          })}
        </p>
        {tz !== hostTimezone && (
          <p className="mt-1 font-mono text-xs text-ink/70">
            {t(locale, "forHost", { time: timeLabel(confirmed.start, hostTimezone), host: hostName })} ({hostTimezone})
          </p>
        )}
        {teamEventTypeId && confirmed.host && (
          <p className="mt-3 text-sm font-medium text-ink">
            {t(locale, "teamAssigned", { name: confirmed.host })}
          </p>
        )}
        <p className="mt-2 text-sm text-ink/70">
          {t(locale, "bookedLine", { min: durationMin, host: hostName, tz })}
        </p>
      </div>
    );
  }

  const tzLabelId = `${uid}-tz`;
  const fieldId = (name: string) => `${uid}-${name}`;
  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink";
  const labelClass = "block text-sm text-ink";
  const consentLinkClass =
    "rounded-sm text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-ink";

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
            aria-label={t(locale, "prevMonth")}
          >
            ←
          </button>
          <div
            className="font-mono text-sm font-medium uppercase tracking-[0.15em] text-ink"
            aria-live="polite"
          >
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() =>
              setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))
            }
            className="h-9 w-9 rounded-full border border-ink/15 text-ink hover:bg-ink hover:text-paper transition"
            aria-label={t(locale, "nextMonth")}
          >
            →
          </button>
        </div>
        <table className="w-full text-center text-sm">
          <caption className="sr-only">{monthLabel}</caption>
          <thead>
            <tr className="font-mono text-[11px] uppercase text-ink/70">
              {t(locale, "weekdaysShort").split(",").map((d) => (
                <th key={d} scope="col" className="pb-3 font-normal">
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
                  const isToday = day === todayYmd;
                  return (
                    <td key={di} className="p-1">
                      {day && (
                        <button
                          type="button"
                          aria-disabled={!available}
                          aria-pressed={selectedDay === day}
                          aria-current={isToday ? "date" : undefined}
                          aria-label={[
                            dayLabel(day),
                            isToday ? t(locale, "today") : null,
                            available ? null : t(locale, "noAvailability"),
                          ]
                            .filter(Boolean)
                            .join(", ")}
                          onClick={() => {
                            if (!available) return;
                            setSelectedDay(day);
                            setSelectedSlot(null);
                          }}
                          className={`h-10 w-10 rounded-full font-mono tabular-nums transition ${
                            selectedDay === day
                              ? "bg-ink text-paper"
                              : available
                                ? "text-ink ring-1 ring-inset ring-ink/25 hover:ring-ink hover:bg-white"
                                : "cursor-default text-ink/40"
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
        <p
          role="status"
          aria-live="polite"
          className="mt-4 min-h-4 font-mono text-xs uppercase tracking-[0.15em] text-ink/70"
        >
          {slots === null ? t(locale, "loadingAvailability") : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs text-ink/70">
          <span id={tzLabelId}>{t(locale, "timesShownIn")}</span>
          <select
            value={tz}
            aria-labelledby={tzLabelId}
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
          {tz !== browserTz && (
            <button
              type="button"
              onClick={() => {
                setTz(browserTz);
                setSelectedDay(null);
                setSelectedSlot(null);
              }}
              aria-label={t(locale, "backToYourTz", { tz: browserTz.replace(/_/g, " ") })}
              title={t(locale, "backToYourTz", { tz: browserTz.replace(/_/g, " ") })}
              className="rounded-full border border-ink/15 px-2.5 py-1 text-[11px] uppercase tracking-wide text-ink/70 hover:border-ink hover:text-ink"
            >
              ↺ {t(locale, "reset")}
            </button>
          )}
          {tz !== hostTimezone && (
            <span className="text-ink/70">
              · {hostName}: {hostTimezone.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-ink/70">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: circadian(8) }} />
          {t(locale, "morning")}
          <span aria-hidden className="ml-3 h-2 w-2 rounded-full" style={{ background: circadian(12.5) }} />
          {t(locale, "midday")}
          <span aria-hidden className="ml-3 h-2 w-2 rounded-full" style={{ background: circadian(17) }} />
          {t(locale, "evening")}
        </div>
      </div>

      <div>
        {selectedDay && !selectedSlot && (
          <div>
            <h3
              className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-ink/70"
              aria-label={t(locale, "selectedDayTimes", { date: dayLabel(selectedDay) })}
            >
              {new Date(selectedDay + "T12:00:00Z").toLocaleDateString(locale, {
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
                const hintId = `${uid}-slot-${i}-host`;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedSlot(iso)}
                    style={{ "--slot-i": i } as React.CSSProperties}
                    aria-label={slotLabel(iso)}
                    aria-describedby={differs ? hintId : undefined}
                    className="slot-cascade group flex w-full items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-2.5 text-left font-mono text-sm tabular-nums text-ink transition hover:border-ink"
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full transition group-hover:scale-125"
                      style={{ background: c }}
                    />
                    {timeLabel(iso)}
                    {differs && (
                      <span id={hintId} className="ml-auto text-xs text-ink/70">
                        {t(locale, "forHost", { time: timeLabel(iso, hostTimezone), host: hostName }).replace(/^= /, "")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {tz !== hostTimezone && (
              <p className="mt-2 font-mono text-[11px] text-ink/70">
                {t(locale, "greyTime", { host: hostName, zone: hostTimezone.replace(/_/g, " ") })}
              </p>
            )}
          </div>
        )}

        {selectedSlot && (
          <form onSubmit={submit} className="space-y-3">
            <h3
              ref={formHeadingRef}
              tabIndex={-1}
              aria-label={t(locale, "detailsHeading", { when: slotLabel(selectedSlot) })}
              className="flex items-center gap-2 font-mono text-sm font-medium text-ink outline-none"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: slotColor(selectedSlot) }}
              />
              {new Date(selectedSlot).toLocaleString(locale, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: tz,
              })}
            </h3>
            {tz !== hostTimezone && (
              <p className="font-mono text-xs text-ink/70">
                {t(locale, "forHost", { time: timeLabel(selectedSlot, hostTimezone), host: hostName })}
              </p>
            )}
            {!rescheduleToken && (
              <>
                <div>
                  <label htmlFor={fieldId("name")} className={labelClass}>
                    {t(locale, "yourName")}
                  </label>
                  <input
                    id={fieldId("name")}
                    name="name"
                    required
                    aria-required="true"
                    autoComplete="name"
                    maxLength={120}
                    placeholder={t(locale, "yourName")}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label htmlFor={fieldId("email")} className={labelClass}>
                    {t(locale, "yourEmail")}
                  </label>
                  <input
                    id={fieldId("email")}
                    name="email"
                    type="email"
                    required
                    aria-required="true"
                    autoComplete="email"
                    maxLength={200}
                    placeholder={t(locale, "yourEmail")}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div>
                  <label htmlFor={fieldId("company")} className={labelClass}>
                    {t(locale, "company")}{" "}
                    <span className="text-ink/70">({t(locale, "optional")})</span>
                  </label>
                  <input
                    id={fieldId("company")}
                    name="company"
                    autoComplete="organization"
                    maxLength={120}
                    placeholder={t(locale, "company")}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                {questions.map((q, i) => (
                  <div key={i}>
                    <label htmlFor={fieldId(`answer-${i}`)} className={labelClass}>
                      {q}
                    </label>
                    <input
                      id={fieldId(`answer-${i}`)}
                      name={`answer_${i}`}
                      required
                      aria-required="true"
                      maxLength={500}
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                ))}
                <div>
                  <label htmlFor={fieldId("notes")} className={labelClass}>
                    {t(locale, "notes")}{" "}
                    <span className="text-ink/70">({t(locale, "optional")})</span>
                  </label>
                  <textarea
                    id={fieldId("notes")}
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    placeholder={t(locale, "notesPlaceholder")}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </>
            )}
            <div role="alert" aria-live="assertive">
              {error && <p className="text-sm text-red-700">{error}</p>}
            </div>
            {!rescheduleToken && (
              <p className="text-xs leading-relaxed text-ink/70">
                {t(locale, "agreeLine")
                  .split(/(\{privacy\}|\{terms\})/)
                  .map((part, i) =>
                    part === "{privacy}" ? (
                      <a key={i} href="/privacy" className={consentLinkClass}>
                        {t(locale, "privacyPolicy")}
                      </a>
                    ) : part === "{terms}" ? (
                      <a key={i} href="/terms" className={consentLinkClass}>
                        {t(locale, "termsOfUse")}
                      </a>
                    ) : (
                      part
                    )
                  )}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t(locale, "bookingEllipsis") : t(locale, rescheduleToken ? "confirmNewTime" : "confirmBooking")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="rounded-lg border border-ink/15 px-3 py-2.5 text-sm text-ink hover:border-ink"
              >
                {t(locale, "back")}
              </button>
            </div>
          </form>
        )}

        {!selectedDay && (
          <p className="pt-10 text-sm text-ink/70">
            {t(locale, "chooseDay")}
          </p>
        )}
      </div>
    </div>
  );
}
