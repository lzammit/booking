import { DateTime } from "luxon";
import db, { Booking, EventType } from "@/lib/db";
import { requireHost } from "@/lib/session";
import { cancelBookingAsHost, disconnectMicrosoft, updateSlug } from "@/lib/actions";
import { msAccountFor, msConfigured } from "@/lib/msgraph";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const host = await requireHost();
  const appHost = (process.env.APP_URL || "").replace(/^https?:\/\//, "");
  const nowIso = DateTime.utc().toISO();
  const upcoming = db
    .prepare(
      `SELECT b.*, e.name AS event_name FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.host_id = ? AND b.status = 'confirmed' AND b.end_utc > ?
       ORDER BY b.start_utc LIMIT 50`
    )
    .all(host.id, nowIso) as (Booking & { event_name: string })[];
  const past = db
    .prepare(
      `SELECT b.*, e.name AS event_name FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.host_id = ? AND NOT (b.status = 'confirmed' AND b.end_utc > ?)
       ORDER BY b.start_utc DESC LIMIT 20`
    )
    .all(host.id, nowIso) as (Booking & { event_name: string })[];
  const msAccount = msAccountFor(host.id);
  const agentSync = db
    .prepare("SELECT source, blocks, last_sync FROM agent_syncs WHERE host_id = ?")
    .all(host.id) as { source: string; blocks: number; last_sync: string }[];
  // Agent pushes every 5 minutes; >15 min silence means it's offline.
  const agents = agentSync.map((s) => {
    const last = DateTime.fromSQL(s.last_sync, { zone: "utc" });
    return {
      ...s,
      connected: DateTime.utc().diff(last, "minutes").minutes < 15,
      lastLabel: last.setZone(host.timezone).toFormat("LLL d, h:mm a"),
      agoLabel: last.toRelative() ?? "",
    };
  });
  const eventTypeCount = (
    db.prepare("SELECT COUNT(*) AS c FROM event_types WHERE host_id = ? AND active = 1").get(host.id) as { c: number }
  ).c;

  const fmt = (iso: string) =>
    DateTime.fromISO(iso, { zone: "utc" })
      .setZone(host.timezone)
      .toFormat("ccc, LLL d yyyy · h:mm a");

  return (
    <main className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hi {host.name.split(" ")[0]}</h1>
        <div className="text-sm text-gray-500">
          {eventTypeCount} active event type{eventTypeCount === 1 ? "" : "s"}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-md bg-green-50 border border-green-200 text-green-700 px-3 py-2 text-sm">
          Saved.
        </p>
      )}

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Your booking link</h2>
        <form action={updateSlug} className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-gray-500 font-mono">{appHost}/book/</span>
          <input
            name="slug"
            defaultValue={host.slug}
            pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]"
            title="2-40 characters: lowercase letters, numbers, dashes"
            className="rounded-lg border border-gray-300 px-3 py-1.5 font-mono w-48"
          />
          <button className="rounded-lg border border-gray-300 px-4 py-1.5 hover:bg-gray-50">
            Save
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          Changing it breaks previously shared links — pick something and stick with it.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 p-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Microsoft 365 calendar</h2>
          <p className="text-sm text-gray-500">
            {!msConfigured()
              ? "Not configured on the server yet — busy times come from bookings only."
              : msAccount
                ? `Connected as ${msAccount}. Busy times are blocked; bookings appear in Outlook.`
                : "Connect to block your busy times and create Outlook events on booking."}
          </p>
        </div>
        {msConfigured() &&
          (msAccount ? (
            <form action={disconnectMicrosoft}>
              <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                Disconnect
              </button>
            </form>
          ) : (
            <a
              href="/api/ms/connect"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Connect
            </a>
          ))}
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Local calendar agent</h2>
          {agents.length > 0 &&
            (agents.some((a) => a.connected) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-700">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Offline
              </span>
            ))}
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-gray-500">
            No agent has synced yet. Install the Mac agent and use the API token below.
          </p>
        ) : (
          <ul className="text-sm text-gray-600 mt-1">
            {agents.map((a) => (
              <li key={a.source}>
                <span className="font-mono">{a.source}</span>: {a.blocks} busy blocks · last
                check-in {a.agoLabel} ({a.lastLabel})
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-3">
          <a
            href="/api/agent/download"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Download Mac agent
          </a>
          <div className="text-xs text-gray-400 space-y-1">
            <p>
              Pre-configured with your token. Unzip and open BookingAgent; when macOS blocks
              it, click Done, then System Settings → Privacy &amp; Security → “Open Anyway”
              (first launch only), and allow Calendar access.
            </p>
            <p>
              If “Open Anyway” is blocked (managed Macs), run this in Terminal, then open the
              app again:{" "}
              <code className="font-mono bg-gray-50 border border-gray-200 rounded px-1">
                xattr -dr com.apple.quarantine ~/Downloads/BookingAgent*/BookingAgent.app
              </code>
            </p>
          </div>
        </div>
        <details className="mt-2">
          <summary className="text-sm text-blue-600 cursor-pointer">Show API token</summary>
          <code className="block mt-1 text-xs bg-gray-50 border border-gray-200 rounded-md p-2 break-all">
            {host.api_token}
          </code>
        </details>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Upcoming bookings</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-500 text-sm">
            Nothing yet. Share your link: <span className="font-mono">/book/{host.slug}</span>
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-4 p-4">
                <div className="flex-1">
                  <div className="font-medium">
                    {b.event_name} — {b.guest_name}
                    {b.guest_company && (
                      <span className="text-gray-500"> ({b.guest_company})</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {fmt(b.start_utc)} · {b.guest_email}
                    {b.notes && <> · “{b.notes}”</>}
                  </div>
                </div>
                <form action={cancelBookingAsHost}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="text-sm text-red-600 hover:underline">Cancel</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Past & cancelled</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 opacity-70">
            {past.map((b) => (
              <li key={b.id} className="p-4 text-sm">
                <span className="font-medium">
                  {b.event_name} — {b.guest_name}
                </span>{" "}
                <span className="text-gray-500">
                  {fmt(b.start_utc)}
                  {b.status === "cancelled" && " · cancelled"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
