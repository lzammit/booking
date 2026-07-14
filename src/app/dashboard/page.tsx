import { DateTime } from "luxon";
import db, { Booking, EventType } from "@/lib/db";
import { requireHost } from "@/lib/session";
import { cancelBookingAsHost, disconnectMicrosoft } from "@/lib/actions";
import { msAccountFor, msConfigured } from "@/lib/msgraph";

export default async function DashboardPage() {
  const host = await requireHost();
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
