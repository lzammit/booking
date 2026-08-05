import { DateTime } from "luxon";
import db, { adminCode, adminCodeEnabled, signupCode, Team, TeamEventType } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AGENT_FRESH_MINUTES } from "@/lib/teams";
import {
  adminAddTeamMember,
  adminCreateTeam,
  adminCreateTeamEventType,
  adminDeleteHost,
  adminDeleteTeam,
  adminDeleteTeamEventType,
  adminInviteUser,
  adminRemoveTeamMember,
  adminResetPassword,
  adminSetAdminCode,
  adminSetSignupCode,
  adminToggleAdmin,
  adminToggleAdminCode,
  adminToggleTeamEventType,
  adminToggleTeamLiveSync,
  adminUpdateTeamEventType,
} from "@/lib/actions";
import ConfirmSubmit from "./ConfirmSubmit";
import AutoSubmitCheckbox from "./AutoSubmitCheckbox";

interface HostRow {
  id: number;
  name: string;
  email: string;
  slug: string;
  timezone: string;
  is_admin: number;
  created_at: string;
  event_types: number;
  upcoming: number;
  total_bookings: number;
  last_sync: string | null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; invited?: string }>;
}) {
  const { error, saved, invited } = await searchParams;
  const admin = await requireAdmin();
  const nowIso = DateTime.utc().toISO();
  const hosts = db
    .prepare(
      `SELECT h.id, h.name, h.email, h.slug, h.timezone, h.is_admin, h.created_at,
        (SELECT COUNT(*) FROM event_types e WHERE e.host_id = h.id AND e.active = 1) AS event_types,
        (SELECT COUNT(*) FROM bookings b WHERE b.host_id = h.id AND b.status = 'confirmed' AND b.end_utc > ?) AS upcoming,
        (SELECT COUNT(*) FROM bookings b WHERE b.host_id = h.id) AS total_bookings,
        (SELECT MAX(a.last_sync) FROM agent_syncs a WHERE a.host_id = h.id) AS last_sync
       FROM hosts h ORDER BY h.id`
    )
    .all(nowIso) as HostRow[];

  const teams = db.prepare("SELECT * FROM teams ORDER BY name").all() as Team[];
  interface MemberRow {
    id: number;
    name: string;
    email: string;
    ics_url: string | null;
    last_sync: string | null;
  }
  // Same rule as lib/teams.ts memberConnected: an ICS feed subscription, or an
  // agent check-in fresher than AGENT_FRESH_MINUTES. Red members are excluded
  // from the team's slots and round-robin.
  const memberLive = (m: MemberRow) => {
    if (m.ics_url) return true;
    if (!m.last_sync) return false;
    const dt = DateTime.fromSQL(m.last_sync, { zone: "utc" });
    return dt.isValid && DateTime.utc().diff(dt, "minutes").minutes < AGENT_FRESH_MINUTES;
  };
  const membersByTeam = new Map<number, MemberRow[]>();
  const eventTypesByTeam = new Map<number, TeamEventType[]>();
  const teamBookings = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings WHERE team_id = ? AND status = 'confirmed' AND end_utc > ?"
  );
  for (const team of teams) {
    membersByTeam.set(
      team.id,
      db
        .prepare(
          `SELECT h.id, h.name, h.email, h.ics_url,
             (SELECT MAX(a.last_sync) FROM agent_syncs a WHERE a.host_id = h.id) AS last_sync
           FROM hosts h
           JOIN team_members m ON m.host_id = h.id
           WHERE m.team_id = ? ORDER BY h.name`
        )
        .all(team.id) as MemberRow[]
    );
    eventTypesByTeam.set(
      team.id,
      db
        .prepare("SELECT * FROM team_event_types WHERE team_id = ? ORDER BY id")
        .all(team.id) as TeamEventType[]
    );
  }

  const agentLabel = (last: string | null) => {
    if (!last) return { text: "never", live: false };
    const dt = DateTime.fromSQL(last, { zone: "utc" });
    return {
      text: dt.toRelative() ?? last,
      live: DateTime.utc().diff(dt, "minutes").minutes < 15,
    };
  };

  return (
    <main className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-gray-500">
          {hosts.length} account{hosts.length === 1 ? "" : "s"} · deleting a user removes
          all their event types, bookings, and calendar data.
        </p>
        </div>
        <a href="/dashboard/admin/stats" className="text-sm text-blue-600 hover:underline">
          Stats →
        </a>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-md bg-green-50 border border-green-200 text-green-700 px-3 py-2 text-sm">
          Done.
        </p>
      )}
      {invited && (
        <p className="rounded-md bg-green-50 border border-green-200 text-green-700 px-3 py-2 text-sm">
          Invitation sent to {invited}.
        </p>
      )}

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Invite a user</h2>
        <p className="text-sm text-gray-500">
          Sends an email with a signup link — invite code and email pre-filled.
        </p>
        <form action={adminInviteUser} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="colleague@example.com"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
            Send invitation
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Invitation code</h2>
        <p className="text-sm text-gray-500">
          {signupCode()
            ? "New accounts must enter this code to sign up."
            : "Signup is currently open — anyone can create an account."}
        </p>
        <form action={adminSetSignupCode} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="code"
            defaultValue={signupCode()}
            placeholder="Empty = open signup"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
            Save
          </button>
          <button
            formAction={async (fd: FormData) => {
              "use server";
              fd.set("code", crypto.randomUUID().replace(/-/g, "").slice(0, 12));
              await adminSetSignupCode(fd);
            }}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Generate new
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Admin onboarding code</h2>
          {adminCodeEnabled() ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Enabled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              Disabled
            </span>
          )}
          <form action={adminToggleAdminCode} className="ml-auto">
            <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              {adminCodeEnabled() ? "Disable" : "Enable"}
            </button>
          </form>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {adminCodeEnabled()
            ? "Anyone who signs up with this code becomes an admin. Keep it secret; share it only with people who should manage the app."
            : "Disabled — the code below is kept but signing up with it no longer grants admin. Enable it to allow admin onboarding."}
        </p>
        <form action={adminSetAdminCode} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="code"
            defaultValue={adminCode()}
            placeholder="No code set"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
            Save
          </button>
          <button
            formAction={async (fd: FormData) => {
              "use server";
              fd.set("code", "adm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16));
              await adminSetAdminCode(fd);
            }}
            className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Generate new
          </button>
        </form>
        {adminCodeEnabled() && adminCode() && (
          <p className="mt-3 text-xs text-gray-400">
            Onboarding link (email &amp; code pre-filled on signup):{" "}
            <code className="break-all">
              {process.env.APP_URL}/signup?invite={encodeURIComponent(adminCode())}
            </code>
          </p>
        )}
      </section>

      <div className="space-y-4">
        {hosts.map((h) => {
          const agent = agentLabel(h.last_sync);
          return (
            <section key={h.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{h.name}</span>
                <span className="text-sm text-gray-500">{h.email}</span>
                {h.is_admin === 1 && (
                  <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
                    admin
                  </span>
                )}
                {h.id === admin.id && (
                  <span className="text-xs text-gray-400">(you)</span>
                )}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                <a
                  href={`/book/${h.slug}`}
                  target="_blank"
                  className="text-blue-600 hover:underline"
                >
                  /book/{h.slug}
                </a>{" "}
                · {h.timezone} · joined {h.created_at.slice(0, 10)}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                <span>{h.event_types} active event types</span>
                <span>{h.upcoming} upcoming bookings</span>
                <span>{h.total_bookings} total</span>
                <span className={agent.live ? "text-green-700" : "text-gray-400"}>
                  agent: {agent.text}
                </span>
              </div>

              {h.id !== admin.id && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
                  <form action={adminToggleAdmin}>
                    <input type="hidden" name="id" value={h.id} />
                    <ConfirmSubmit
                      variant="neutral"
                      label={h.is_admin ? "Remove admin" : "Make admin"}
                      confirmText={
                        h.is_admin
                          ? `Remove admin rights from ${h.name}?`
                          : `Make ${h.name} an admin? They'll be able to manage all users, and will be notified by email.`
                      }
                    />
                  </form>
                  <form action={adminResetPassword} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={h.id} />
                    <input
                      name="password"
                      type="text"
                      minLength={8}
                      required
                      placeholder="New password"
                      className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                    />
                    <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
                      Reset password
                    </button>
                  </form>
                  <form action={adminDeleteHost} className="ml-auto">
                    <input type="hidden" name="id" value={h.id} />
                    <ConfirmSubmit
                      label="Delete user"
                      confirmText={`Delete ${h.name} (${h.email}) and all their data? This cannot be undone.`}
                    />
                  </form>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="pt-4">
        <h1 className="text-2xl font-bold">Teams</h1>
        <p className="text-sm text-gray-500">
          A team has one shared booking link that offers every slot where at least one
          member is free. Bookings go to the free member with the fewest upcoming
          meetings, and land on that member&apos;s calendar like any direct booking.
          <span className="text-green-700"> Green</span> members have live busy sync
          (agent check-in within {AGENT_FRESH_MINUTES} min, or an ICS feed);
          <span className="text-red-600"> red</span> members don&apos;t. Each
          team&apos;s checkbox decides whether red members are skipped, or still
          booked using the last calendar data they synced.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Create a team</h2>
        <form action={adminCreateTeam} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="name"
            required
            placeholder="e.g. Product Support Engineers"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
            Create team
          </button>
        </form>
      </section>

      {teams.map((team) => {
        const members = membersByTeam.get(team.id) ?? [];
        const memberIds = new Set(members.map((m) => m.id));
        const candidates = hosts.filter((h) => !memberIds.has(h.id));
        const eventTypes = eventTypesByTeam.get(team.id) ?? [];
        const upcoming = (teamBookings.get(team.id, nowIso) as { c: number }).c;
        const etFields = (et?: TeamEventType) => (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              name="name"
              required
              defaultValue={et?.name}
              placeholder="Meeting name"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
            <label className="text-sm text-gray-600">
              Duration (min)
              <input
                name="duration_min"
                type="number"
                min={5}
                max={480}
                defaultValue={et?.duration_min ?? 30}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-gray-600">
              Buffer (min)
              <input
                name="buffer_min"
                type="number"
                min={0}
                max={120}
                defaultValue={et?.buffer_min ?? 0}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-gray-600">
              Min notice (min)
              <input
                name="min_notice_min"
                type="number"
                min={0}
                max={10080}
                defaultValue={et?.min_notice_min ?? 120}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-gray-600">
              Booking window (days)
              <input
                name="window_days"
                type="number"
                min={1}
                max={365}
                defaultValue={et?.window_days ?? 30}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </label>
            <input
              name="description"
              defaultValue={et?.description}
              placeholder="Description (optional)"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
            <input
              name="meeting_url"
              defaultValue={et?.meeting_url}
              placeholder="Static meeting link, e.g. Webex room (optional)"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
            <textarea
              name="questions"
              defaultValue={et?.questions}
              rows={3}
              placeholder={"Booking questions, one per line (optional)\ne.g. PacketFence version?"}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
          </div>
        );
        return (
          <section key={team.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{team.name}</span>
              <a
                href={`/team/${team.slug}`}
                target="_blank"
                className="text-sm text-blue-600 hover:underline"
              >
                /team/{team.slug}
              </a>
              <span className="text-sm text-gray-500">
                · {members.length} member{members.length === 1 ? "" : "s"} (
                {team.require_live_sync
                  ? members.filter(memberLive).length
                  : members.length}{" "}
                in rotation) · {upcoming} upcoming
              </span>
              <form action={adminDeleteTeam} className="ml-auto">
                <input type="hidden" name="id" value={team.id} />
                <ConfirmSubmit
                  label="Delete team"
                  confirmText={`Delete team ${team.name}? Its booking link stops working; members and their existing bookings are kept.`}
                />
              </form>
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="text-sm font-medium text-gray-700">Members</h3>
              <form action={adminToggleTeamLiveSync} className="mt-2">
                <input type="hidden" name="id" value={team.id} />
                <AutoSubmitCheckbox
                  checked={team.require_live_sync === 1}
                  label="Only round-robin members with live busy sync — when off, offline members are booked too, using the last calendar data they synced"
                />
              </form>
              <ul className="mt-2 space-y-1">
                {members.map((m) => {
                  const live = memberLive(m);
                  return (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden
                        className={`h-2 w-2 rounded-full ${live ? "bg-green-500" : "bg-red-500"}`}
                      />
                      <span className={live ? "font-medium text-green-700" : "font-medium text-red-600"}>
                        {m.name}
                      </span>
                      <span className="text-gray-400">{m.email}</span>
                      {!live &&
                        (team.require_live_sync ? (
                          <span className="text-xs text-red-500">
                            no busy sync — excluded from the round-robin
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600">
                            offline — booked from last-synced calendar
                          </span>
                        ))}
                      <form action={adminRemoveTeamMember}>
                        <input type="hidden" name="team_id" value={team.id} />
                        <input type="hidden" name="host_id" value={m.id} />
                        <button
                          className="text-gray-400 hover:text-red-600"
                          title={`Remove ${m.name} from ${team.name}`}
                        >
                          ✕
                        </button>
                      </form>
                    </li>
                  );
                })}
                {members.length === 0 && (
                  <li className="text-sm text-amber-700">
                    No members yet — the booking page shows no availability until someone
                    is added.
                  </li>
                )}
              </ul>
              {candidates.length > 0 && (
                <form action={adminAddTeamMember} className="mt-2 flex items-center gap-2">
                  <input type="hidden" name="team_id" value={team.id} />
                  <select
                    name="host_id"
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    {candidates.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.email})
                      </option>
                    ))}
                  </select>
                  <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
                    Add member
                  </button>
                </form>
              )}
            </div>

            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="text-sm font-medium text-gray-700">Meeting types</h3>
              <ul className="mt-2 space-y-2">
                {eventTypes.map((et) => (
                  <li key={et.id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={et.active ? "" : "text-gray-400 line-through"}>
                        {et.name}
                      </span>
                      <span className="text-gray-400">{et.duration_min} min</span>
                      <span className="ml-auto flex items-center gap-2">
                        <form action={adminToggleTeamEventType}>
                          <input type="hidden" name="id" value={et.id} />
                          <button className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">
                            {et.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        <form action={adminDeleteTeamEventType}>
                          <input type="hidden" name="id" value={et.id} />
                          <ConfirmSubmit
                            label="Delete"
                            confirmText={`Delete meeting type "${et.name}" from ${team.name}?`}
                          />
                        </form>
                      </span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">
                        Edit
                      </summary>
                      <form action={adminUpdateTeamEventType}>
                        <input type="hidden" name="id" value={et.id} />
                        {etFields(et)}
                        <button className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                          Save
                        </button>
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-blue-600 hover:underline">
                  Add a meeting type
                </summary>
                <form action={adminCreateTeamEventType}>
                  <input type="hidden" name="team_id" value={team.id} />
                  {etFields()}
                  <button className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                    Add meeting type
                  </button>
                </form>
              </details>
            </div>
          </section>
        );
      })}
    </main>
  );
}
