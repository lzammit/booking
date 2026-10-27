import { DateTime } from "luxon";
import db, { Booking, EventType } from "@/lib/db";
import { requireHost } from "@/lib/session";
import {
  cancelBookingAsHost,
  deletePastBooking,
  reassignTeamBooking,
  inviteToBooking,
  uninviteFromBooking,
  updateSlug,
} from "@/lib/actions";
import ConfirmSubmit from "./admin/ConfirmSubmit";
import { displayTicket, ticketUrl } from "@/lib/tickets";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; warn?: string }>;
}) {
  const { error, saved, warn } = await searchParams;
  const host = await requireHost();
  const appHost = (process.env.APP_URL || "").replace(/^https?:\/\//, "");
  const nowIso = DateTime.utc().toISO();
  const upcoming = db
    .prepare(
      `SELECT b.*, e.name AS event_name, t.name AS team_name, t.ticket_help_url AS team_help_url FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       LEFT JOIN teams t ON t.id = b.team_id
       WHERE b.host_id = ? AND b.status = 'confirmed' AND b.end_utc > ?
       ORDER BY b.start_utc LIMIT 50`
    )
    .all(host.id, nowIso) as (Booking & { event_name: string; team_name: string | null; team_help_url: string | null })[];
  const past = db
    .prepare(
      `SELECT b.*, e.name AS event_name, t.name AS team_name, t.ticket_help_url AS team_help_url FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       LEFT JOIN teams t ON t.id = b.team_id
       WHERE b.host_id = ? AND NOT (b.status = 'confirmed' AND b.end_utc > ?)
       ORDER BY b.start_utc DESC LIMIT 20`
    )
    .all(host.id, nowIso) as (Booking & { event_name: string; team_name: string | null; team_help_url: string | null })[];
  const eventTypeCount = (
    db.prepare("SELECT COUNT(*) AS c FROM event_types WHERE host_id = ? AND active = 1").get(host.id) as { c: number }
  ).c;

  // Hand-off targets: other members of each team this host has bookings for.
  // People the host invited to each upcoming booking ("Invite someone").
  const inviteesByBooking = new Map<number, { id: number; email: string; name: string; host_id: number | null }[]>();
  if (upcoming.length) {
    const rows = db
      .prepare(
        `SELECT id, booking_id, email, name, host_id FROM booking_invitees
         WHERE removed_at IS NULL AND booking_id IN (${upcoming.map(() => "?").join(",")})
         ORDER BY id`
      )
      .all(...upcoming.map((b) => b.id)) as { id: number; booking_id: number; email: string; name: string; host_id: number | null }[];
    for (const r of rows) {
      const list = inviteesByBooking.get(r.booking_id) ?? [];
      list.push(r);
      inviteesByBooking.set(r.booking_id, list);
    }
  }
  // Booking accounts, to suggest colleagues in the invite field.
  const colleagues = db
    .prepare("SELECT name, email FROM hosts WHERE id != ? ORDER BY name")
    .all(host.id) as { name: string; email: string }[];

  const teamIds = [...new Set(upcoming.map((b) => b.team_id).filter(Boolean))] as number[];
  const teammates = new Map<number, { id: number; name: string }[]>();
  for (const tid of teamIds) {
    teammates.set(
      tid,
      db
        .prepare(
          `SELECT h.id, h.name FROM hosts h
           JOIN team_members m ON m.host_id = h.id
           WHERE m.team_id = ? AND h.id != ? ORDER BY h.name`
        )
        .all(tid, host.id) as { id: number; name: string }[]
    );
  }

  const fmt = (iso: string) =>
    DateTime.fromISO(iso, { zone: "utc" })
      .setZone(host.timezone)
      .toFormat("ccc, LLL d yyyy · h:mm a");

  /** The guest's local time, when it differs from the host's. */
  const guestTime = (b: Booking): string | null => {
    if (!b.guest_timezone || b.guest_timezone === host.timezone) return null;
    const dt = DateTime.fromISO(b.start_utc, { zone: "utc" }).setZone(b.guest_timezone);
    if (!dt.isValid) return null;
    return `${dt.toFormat("h:mm a")} for them (${b.guest_timezone.replace(/_/g, " ")})`;
  };

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
      {warn && (
        <p className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-sm">
          {warn}
        </p>
      )}
      {saved && (
        <p className="rounded-md bg-green-50 border border-green-200 text-green-700 px-3 py-2 text-sm">
          {saved === "1" ? "Saved." : saved}
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
          You can rename this anytime — links you already shared keep working
          and redirect to the new one.
        </p>
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
                    {b.team_name && (
                      <span className="ml-2 rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs font-medium text-purple-700">
                        via {b.team_name}
                      </span>
                    )}
                    {b.ticket_id && (
                      <a
                        href={ticketUrl(b.ticket_id, b.team_help_url ?? "")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 rounded-full border border-gray-300 bg-white px-2 py-0.5 font-mono text-xs font-medium text-gray-700 hover:border-gray-500"
                        title="Open the ticket in Mantis"
                      >
                        #{displayTicket(b.ticket_id)}
                      </a>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {fmt(b.start_utc)}
                    {guestTime(b) && (
                      <span className="text-gray-400"> · {guestTime(b)}</span>
                    )}{" "}
                    · {b.guest_email}
                    {b.notes && <> · “{b.notes}”</>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    {(inviteesByBooking.get(b.id) ?? []).map((inv) => (
                      <span
                        key={inv.id}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2 pr-1 text-gray-700"
                        title={inv.host_id ? `${inv.email} · on their calendar through BookingAgent` : `${inv.email} · email invite`}
                      >
                        {inv.name || inv.email}
                        <form action={uninviteFromBooking}>
                          <input type="hidden" name="invitee_id" value={inv.id} />
                          <button
                            className="rounded-full px-1 text-gray-400 hover:bg-gray-200 hover:text-red-600"
                            aria-label={`Remove ${inv.name || inv.email} from this meeting`}
                          >
                            ×
                          </button>
                        </form>
                      </span>
                    ))}
                    <details className="inline-block">
                      <summary className="cursor-pointer list-none rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-gray-500 hover:border-gray-500 hover:text-gray-800">
                        + Invite someone
                      </summary>
                      <form action={inviteToBooking} className="mt-1.5 flex items-center gap-1.5">
                        <input type="hidden" name="id" value={b.id} />
                        <input
                          name="email"
                          type="email"
                          required
                          list="colleague-emails"
                          placeholder="colleague@akamai.com"
                          aria-label="Email of the person to invite"
                          className="w-56 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700">
                          Invite
                        </button>
                      </form>
                    </details>
                  </div>
                </div>
                {b.team_id && (teammates.get(b.team_id)?.length ?? 0) > 0 && (
                  <form action={reassignTeamBooking} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={b.id} />
                    <select
                      name="target_id"
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                    >
                      {teammates.get(b.team_id)!.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-sm text-blue-600 hover:underline"
                      title="Hand this booking off — the guest gets an updated invite from the new host"
                    >
                      Reassign
                    </button>
                  </form>
                )}
                <a
                  href={`/reschedule/${b.cancel_token}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Reschedule
                </a>
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
              <li key={b.id} className="flex items-center gap-4 p-4 text-sm">
                <div className="flex-1">
                  <span
                    className={`font-medium ${b.status === "cancelled" ? "line-through text-gray-400" : ""}`}
                  >
                    {b.event_name} — {b.guest_name}
                    {b.guest_company && (
                      <span className="font-normal text-gray-500"> ({b.guest_company})</span>
                    )}
                  </span>{" "}
                  <span className="text-gray-500">
                    {fmt(b.start_utc)}
                    {b.status === "cancelled" && " · cancelled"}
                  </span>
                </div>
                {b.status === "confirmed" && (
                  <a
                    href={`/reschedule/${b.cancel_token}`}
                    className="text-blue-600 hover:underline"
                  >
                    Reschedule
                  </a>
                )}
                <form action={deletePastBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <ConfirmSubmit
                    label="Remove"
                    confirmText={`Remove "${b.event_name} — ${b.guest_name}" from your history? This can't be undone.`}
                  />
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      <datalist id="colleague-emails">
        {colleagues.map((c) => (
          <option key={c.email} value={c.email}>
            {c.name}
          </option>
        ))}
      </datalist>
    </main>
  );
}
