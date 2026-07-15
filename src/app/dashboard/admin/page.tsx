import { DateTime } from "luxon";
import db, { signupCode } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import {
  adminDeleteHost,
  adminInviteUser,
  adminResetPassword,
  adminSetSignupCode,
  adminToggleAdmin,
} from "@/lib/actions";
import ConfirmSubmit from "./ConfirmSubmit";

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
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-gray-500">
          {hosts.length} account{hosts.length === 1 ? "" : "s"} · deleting a user removes
          all their event types, bookings, and calendar data.
        </p>
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
                /book/{h.slug} · {h.timezone} · joined {h.created_at.slice(0, 10)}
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
    </main>
  );
}
