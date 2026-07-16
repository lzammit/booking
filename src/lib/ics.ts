import { DateTime, IANAZone } from "luxon";

/**
 * Minimal ICS parser for calendar feeds (Google secret address, published
 * Outlook calendars, iCloud public links, any ICS URL) → busy intervals.
 *
 * Supported: DAILY / WEEKLY (BYDAY) / simple MONTHLY recurrences with
 * INTERVAL, COUNT, UNTIL; EXDATE; RECURRENCE-ID overrides (rescheduled or
 * cancelled single occurrences); Windows and IANA time zone names. Skips
 * transparent (free), cancelled, and all-day events. Pure — no I/O.
 */

const WINDOWS_TZ: Record<string, string> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Atlantic Standard Time": "America/Halifax",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Helsinki",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabian Standard Time": "Asia/Dubai",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "SA Pacific Standard Time": "America/Bogota",
  "E. South America Standard Time": "America/Sao_Paulo",
};

interface Prop {
  params: Record<string, string>;
  value: string;
}

interface VEventRecord {
  props: Record<string, Prop>;
  exdates: DateTime[];
  uid: string;
  recurrenceId: DateTime | null;
}

function parseLine(line: string): [string, Prop] | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const parts = line.slice(0, colon).split(";");
  const name = parts.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return [name, { params, value: line.slice(colon + 1) }];
}

function zoneFor(tzid: string | undefined): string {
  if (!tzid) return "utc";
  if (IANAZone.isValidZone(tzid)) return tzid;
  return WINDOWS_TZ[tzid] ?? "utc";
}

function parseIcsDate(prop: Prop): {
  dt: DateTime | null;
  dateOnly: boolean;
  zone: string;
} {
  const v = prop.value;
  if (prop.params["VALUE"] === "DATE" || (!v.includes("T") && v.length === 8)) {
    return { dt: null, dateOnly: true, zone: "utc" };
  }
  if (v.endsWith("Z")) {
    const dt = DateTime.fromFormat(v.slice(0, -1), "yyyyMMdd'T'HHmmss", { zone: "utc" });
    return { dt: dt.isValid ? dt : null, dateOnly: false, zone: "utc" };
  }
  const zone = zoneFor(prop.params["TZID"]);
  const dt = DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss", { zone });
  return { dt: dt.isValid ? dt : null, dateOnly: false, zone };
}

function parseDuration(value: string): number | null {
  let seconds = 0;
  let digits = "";
  let inTime = false;
  for (const ch of value) {
    if (ch === "P" || ch === "+") continue;
    if (ch === "T") {
      inTime = true;
    } else if (ch >= "0" && ch <= "9") {
      digits += ch;
    } else {
      const n = Number(digits) || 0;
      digits = "";
      if (ch === "W") seconds += n * 604800;
      else if (ch === "D") seconds += n * 86400;
      else if (ch === "H") seconds += n * 3600;
      else if (ch === "M") seconds += n * (inTime ? 60 : 2592000);
      else if (ch === "S") seconds += n;
      else return null;
    }
  }
  return seconds > 0 ? seconds : null;
}

export function parseIcsBusy(
  ics: string,
  windowStart: DateTime,
  windowEnd: DateTime
): { start: string; end: string }[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");

  // Pass 1: collect all VEVENTs.
  const records: VEventRecord[] = [];
  let current: VEventRecord | null = null;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line === "BEGIN:VEVENT") {
      current = { props: {}, exdates: [], uid: "", recurrenceId: null };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) records.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [name, prop] = parsed;
    if (name === "UID") {
      current.uid = prop.value;
    } else if (name === "RECURRENCE-ID") {
      current.recurrenceId = parseIcsDate(prop).dt;
    } else if (name === "EXDATE") {
      for (const v of prop.value.split(",")) {
        const { dt } = parseIcsDate({ params: prop.params, value: v });
        if (dt) current.exdates.push(dt);
      }
    } else if (["DTSTART", "DTEND", "DURATION", "RRULE", "TRANSP", "STATUS"].includes(name)) {
      current.props[name] = prop;
    }
  }

  // Overridden occurrences (rescheduled/cancelled single instances): their
  // original times must be excluded from the master series expansion.
  const overridden = new Map<string, DateTime[]>();
  for (const record of records) {
    if (record.recurrenceId && record.uid) {
      const list = overridden.get(record.uid) ?? [];
      list.push(record.recurrenceId);
      overridden.set(record.uid, list);
    }
  }

  // Pass 2: expand.
  const out: { start: string; end: string }[] = [];
  for (const record of records) {
    const exclusions = record.recurrenceId
      ? [] // an override IS the occurrence — nothing to exclude from it
      : [...record.exdates, ...(overridden.get(record.uid) ?? [])];
    expand(record.props, exclusions, windowStart, windowEnd, out);
  }
  return out;
}

function expand(
  props: Record<string, Prop>,
  exclusions: DateTime[],
  windowStart: DateTime,
  windowEnd: DateTime,
  out: { start: string; end: string }[]
) {
  if (props["TRANSP"]?.value.toUpperCase() === "TRANSPARENT") return;
  if (props["STATUS"]?.value.toUpperCase() === "CANCELLED") return;
  const dtstart = props["DTSTART"];
  if (!dtstart) return;
  const { dt: seriesStart, dateOnly, zone } = parseIcsDate(dtstart);
  if (!seriesStart || dateOnly) return; // all-day events skipped

  let durationSec = 1800;
  const dtend = props["DTEND"] ? parseIcsDate(props["DTEND"]).dt : null;
  if (dtend) {
    durationSec = Math.max(60, dtend.diff(seriesStart, "seconds").seconds);
  } else if (props["DURATION"]) {
    durationSec = Math.max(60, parseDuration(props["DURATION"].value) ?? 1800);
  }

  const emit = (s: DateTime) => {
    const e = s.plus({ seconds: durationSec });
    if (e <= windowStart || s >= windowEnd) return;
    if (exclusions.some((x) => Math.abs(x.diff(s, "seconds").seconds) < 1)) return;
    out.push({ start: s.toUTC().toISO()!, end: e.toUTC().toISO()! });
  };

  const rruleStr = props["RRULE"]?.value;
  if (!rruleStr) {
    emit(seriesStart);
    return;
  }

  const rules: Record<string, string> = {};
  for (const part of rruleStr.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) rules[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const interval = Math.max(1, parseInt(rules["INTERVAL"] ?? "1", 10) || 1);
  const count = rules["COUNT"] ? parseInt(rules["COUNT"], 10) : null;
  let until: DateTime | null = null;
  if (rules["UNTIL"]) {
    until = rules["UNTIL"].includes("T")
      ? parseIcsDate({ params: {}, value: rules["UNTIL"] }).dt
      : DateTime.fromFormat(rules["UNTIL"], "yyyyMMdd", { zone: "utc" }).endOf("day");
  }

  let occurrences = 0;
  const MAX_ITERATIONS = 800;
  const going = (d: DateTime) =>
    (count === null || occurrences < count) && (!until || d <= until) && d < windowEnd;

  const freq = rules["FREQ"];
  if (freq === "DAILY") {
    let cursor = seriesStart;
    for (let i = 0; going(cursor) && i < MAX_ITERATIONS; i++) {
      emit(cursor);
      occurrences++;
      cursor = cursor.plus({ days: interval });
    }
  } else if (freq === "WEEKLY") {
    const map: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
    const weekdays = rules["BYDAY"]
      ? rules["BYDAY"]
          .split(",")
          .map((d) => map[d.slice(-2)])
          .filter(Boolean)
          .sort((a, b) => a - b)
      : [seriesStart.setZone(zone).weekday];
    let weekCursor = seriesStart;
    outer: for (let i = 0; i < MAX_ITERATIONS; i++) {
      for (const weekday of weekdays) {
        const occurrence = weekCursor.set({ weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 });
        if (occurrence < seriesStart) continue;
        if (!going(occurrence)) break outer;
        emit(occurrence);
        occurrences++;
      }
      weekCursor = weekCursor.plus({ weeks: interval });
    }
  } else if (freq === "MONTHLY" && !rules["BYDAY"]) {
    let cursor = seriesStart;
    for (let i = 0; going(cursor) && i < MAX_ITERATIONS; i++) {
      emit(cursor);
      occurrences++;
      cursor = cursor.plus({ months: interval });
    }
  } else {
    // Unsupported recurrence (MONTHLY BYDAY, YEARLY): master occurrence only.
    emit(seriesStart);
  }
}
