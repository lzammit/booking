import { DateTime } from "luxon";
import db, { Host } from "./db";
import { parseIcsBusy } from "./ics";

/**
 * Calendar feed (ICS URL) → busy intervals, polled server-side. The
 * zero-install path for hosts whose calendar isn't on the Mac: Google
 * Calendar's "Secret address in iCal format", a published Outlook calendar
 * (when the org allows publishing), an iCloud public calendar link, or any
 * other ICS URL. No admin consent needed anywhere.
 */

const STALE_MINUTES = 15;
const SOURCE = "ics-feed";
/** Earlier deploys stored the Outlook-specific source name. */
const LEGACY_SOURCES = ["outlook-feed"];

/**
 * SSRF guard for host-supplied feed URLs: require https and reject IP-literal
 * or obviously-internal hostnames, so the server can't be pointed at
 * localhost, the cloud metadata service, or other private endpoints.
 * (DNS-rebinding-grade attacks are out of scope for this threat model.)
 */
function assertPublicFeedUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("ICS feed URL must be https");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.startsWith("[") || // IPv6 literal
    /^\d+\.\d+\.\d+\.\d+$/.test(h) // IPv4 literal (public ones excluded too — real feeds use hostnames)
  ) {
    throw new Error("ICS feed URL must use a public hostname");
  }
}

/** Fetch with redirects followed manually so every hop is SSRF-checked. */
async function fetchPublic(url: string): Promise<Response> {
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    assertPublicFeedUrl(target);
    const res = await fetch(target, {
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`ICS feed redirect without location`);
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
  throw new Error("ICS feed: too many redirects");
}

/** Fetch the feed and replace this host's stored busy intervals. */
export async function refreshIcsFeed(hostId: number, url: string): Promise<number> {
  const res = await fetchPublic(url);
  if (!res.ok) throw new Error(`ICS feed returned HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Not an ICS calendar");

  const windowStart = DateTime.utc().minus({ days: 1 });
  const windowEnd = DateTime.utc().plus({ days: 62 });
  // All-day events carry no timezone — interpret their day boundaries in the
  // host's timezone so e.g. a day off blocks that host's actual day.
  const hostRow = db.prepare("SELECT timezone FROM hosts WHERE id = ?").get(hostId) as
    | { timezone: string }
    | undefined;
  const intervals = parseIcsBusy(text, windowStart, windowEnd, hostRow?.timezone ?? "utc");

  const tx = db.transaction(() => {
    for (const source of [SOURCE, ...LEGACY_SOURCES]) {
      db.prepare("DELETE FROM external_busy WHERE host_id = ? AND source = ?").run(hostId, source);
      db.prepare("DELETE FROM agent_syncs WHERE host_id = ? AND source = ?").run(hostId, source);
    }
    const ins = db.prepare(
      "INSERT INTO external_busy (host_id, source, start_utc, end_utc) VALUES (?, ?, ?, ?)"
    );
    for (const iv of intervals) ins.run(hostId, SOURCE, iv.start, iv.end);
    db.prepare(
      "INSERT INTO agent_syncs (host_id, source, last_sync, blocks) VALUES (?, ?, datetime('now'), ?)"
    ).run(hostId, SOURCE, intervals.length);
  });
  tx();
  return intervals.length;
}

/** Refresh at most every STALE_MINUTES; failures never break availability. */
export async function refreshIcsFeedIfStale(host: Host): Promise<void> {
  if (!host.ics_url) return;
  const row = db
    .prepare("SELECT last_sync FROM agent_syncs WHERE host_id = ? AND source = ?")
    .get(host.id, SOURCE) as { last_sync: string } | undefined;
  if (row) {
    const last = DateTime.fromSQL(row.last_sync, { zone: "utc" });
    if (last.isValid && DateTime.utc().diff(last, "minutes").minutes < STALE_MINUTES) {
      return;
    }
  }
  try {
    await refreshIcsFeed(host.id, host.ics_url);
  } catch (err) {
    console.error(`ICS feed refresh failed for host ${host.id}:`, err);
  }
}

/** Remove the subscription and all imported busy data. */
export function clearIcsFeedData(hostId: number) {
  for (const source of [SOURCE, ...LEGACY_SOURCES]) {
    db.prepare("DELETE FROM external_busy WHERE host_id = ? AND source = ?").run(hostId, source);
    db.prepare("DELETE FROM agent_syncs WHERE host_id = ? AND source = ?").run(hostId, source);
  }
}
