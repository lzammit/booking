import Link from "next/link";
import { DateTime } from "luxon";
import db from "@/lib/db";
import { requireAdmin } from "@/lib/session";

interface Row {
  id: number;
  host_id: number;
  host_name: string;
  event_name: string;
  team_id: number | null;
  status: string;
  start_utc: string;
  created_at: string;
}

/** Horizontal bar scaled against the section's max value. */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 rounded bg-blue-500/80" style={{ width: `${pct}%`, minWidth: value > 0 ? "0.5rem" : "0" }} />
      <span className="whitespace-nowrap font-mono text-xs text-gray-600">{label}</span>
    </div>
  );
}

export default async function AdminStatsPage() {
  const admin = await requireAdmin();
  const rows = db
    .prepare(
      `SELECT b.id, b.host_id, h.name AS host_name, e.name AS event_name,
              b.team_id, b.status, b.start_utc, b.created_at
       FROM bookings b
       JOIN hosts h ON h.id = b.host_id
       JOIN event_types e ON e.id = b.event_type_id`
    )
    .all() as Row[];
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const tz = admin.timezone;
  const now = DateTime.utc();

  // Bookings per member per month (last 6 months, by meeting start).
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) months.push(now.setZone(tz).minus({ months: i }).toFormat("yyyy-MM"));
  const byMember = new Map<string, { total: Map<string, number>; team: Map<string, number> }>();
  for (const r of confirmed) {
    const m = DateTime.fromISO(r.start_utc, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM");
    if (!months.includes(m)) continue;
    const entry = byMember.get(r.host_name) ?? { total: new Map(), team: new Map() };
    entry.total.set(m, (entry.total.get(m) ?? 0) + 1);
    if (r.team_id) entry.team.set(m, (entry.team.get(m) ?? 0) + 1);
    byMember.set(r.host_name, entry);
  }

  // Cancellation rate per member (all time).
  const cancelStats = new Map<string, { total: number; cancelled: number }>();
  for (const r of rows) {
    const s = cancelStats.get(r.host_name) ?? { total: 0, cancelled: 0 };
    s.total++;
    if (r.status === "cancelled") s.cancelled++;
    cancelStats.set(r.host_name, s);
  }

  // Busiest hours (confirmed, viewed in the admin's timezone).
  const hourCounts = new Map<number, number>();
  for (const r of confirmed) {
    const h = DateTime.fromISO(r.start_utc, { zone: "utc" }).setZone(tz).hour;
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }
  const hours = [...hourCounts.entries()].sort((a, b) => a[0] - b[0]);
  const maxHour = Math.max(0, ...hourCounts.values());

  // Lead time: how far ahead guests book.
  const leadBuckets: [string, (h: number) => boolean][] = [
    ["< 1 day", (h) => h < 24],
    ["1–3 days", (h) => h >= 24 && h < 72],
    ["3–7 days", (h) => h >= 72 && h < 168],
    ["> 7 days", (h) => h >= 168],
  ];
  const leads = new Map<string, number>(leadBuckets.map(([l]) => [l, 0]));
  for (const r of confirmed) {
    const created = DateTime.fromSQL(r.created_at, { zone: "utc" });
    const start = DateTime.fromISO(r.start_utc, { zone: "utc" });
    if (!created.isValid || !start.isValid) continue;
    const h = start.diff(created, "hours").hours;
    for (const [label, test] of leadBuckets) {
      if (test(h)) {
        leads.set(label, (leads.get(label) ?? 0) + 1);
        break;
      }
    }
  }
  const maxLead = Math.max(0, ...leads.values());

  // Meeting type popularity (confirmed, all time).
  const typeCounts = new Map<string, number>();
  for (const r of confirmed) typeCounts.set(r.event_name, (typeCounts.get(r.event_name) ?? 0) + 1);
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxType = types[0]?.[1] ?? 0;

  const monthLabel = (m: string) =>
    DateTime.fromFormat(m, "yyyy-MM").toFormat("LLL");

  return (
    <main className="space-y-8">
      <div>
        <Link href="/dashboard/admin" className="text-sm text-blue-600 hover:underline">
          ← Admin
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Stats</h1>
        <p className="text-sm text-gray-500">
          {confirmed.length} confirmed booking{confirmed.length === 1 ? "" : "s"} ·{" "}
          {rows.length - confirmed.length} cancelled · times in {tz}
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Bookings per member · last 6 months</h2>
        <p className="text-sm text-gray-500">Confirmed, by meeting date. Team-link bookings in parentheses.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-400">
                <th className="py-1 pr-4 font-normal">Member</th>
                {months.map((m) => (
                  <th key={m} className="px-2 py-1 text-right font-normal">{monthLabel(m)}</th>
                ))}
                <th className="px-2 py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...byMember.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, e]) => {
                  const total = [...e.total.values()].reduce((s, v) => s + v, 0);
                  const teamTotal = [...e.team.values()].reduce((s, v) => s + v, 0);
                  return (
                    <tr key={name} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 font-medium">{name}</td>
                      {months.map((m) => (
                        <td key={m} className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {e.total.get(m) ?? 0}
                          {(e.team.get(m) ?? 0) > 0 && (
                            <span className="text-purple-600"> ({e.team.get(m)})</span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
                        {total}
                        {teamTotal > 0 && <span className="text-purple-600"> ({teamTotal})</span>}
                      </td>
                    </tr>
                  );
                })}
              {byMember.size === 0 && (
                <tr><td className="py-2 text-gray-400">No bookings in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Cancellation rate</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {[...cancelStats.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, s]) => (
              <li key={name} className="flex items-baseline gap-2">
                <span className="w-48 truncate font-medium">{name}</span>
                <span className="font-mono text-xs text-gray-600">
                  {s.cancelled}/{s.total} ({s.total ? Math.round((s.cancelled / s.total) * 100) : 0}%)
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Busiest hours</h2>
        <p className="text-sm text-gray-500">When confirmed meetings start ({tz}).</p>
        <div className="mt-3 space-y-1">
          {hours.map(([h, c]) => (
            <div key={h} className="flex items-center gap-2 text-sm">
              <span className="w-14 shrink-0 font-mono text-xs text-gray-500">
                {DateTime.fromObject({ hour: h }).toFormat("h a")}
              </span>
              <div className="flex-1"><Bar value={c} max={maxHour} label={String(c)} /></div>
            </div>
          ))}
          {hours.length === 0 && <p className="text-sm text-gray-400">No data yet.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Booking lead time</h2>
        <p className="text-sm text-gray-500">How far in advance guests book.</p>
        <div className="mt-3 space-y-1">
          {leadBuckets.map(([label]) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs text-gray-500">{label}</span>
              <div className="flex-1">
                <Bar value={leads.get(label) ?? 0} max={maxLead} label={String(leads.get(label) ?? 0)} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Popular meeting types</h2>
        <div className="mt-3 space-y-1">
          {types.map(([name, c]) => (
            <div key={name} className="flex items-center gap-2 text-sm">
              <span className="w-56 shrink-0 truncate text-gray-700">{name}</span>
              <div className="flex-1"><Bar value={c} max={maxType} label={String(c)} /></div>
            </div>
          ))}
          {types.length === 0 && <p className="text-sm text-gray-400">No data yet.</p>}
        </div>
      </section>
    </main>
  );
}
