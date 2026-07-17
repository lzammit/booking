import db, { EventType } from "@/lib/db";
import { requireHost } from "@/lib/session";
import { createEventType, deleteEventType, updateEventType } from "@/lib/actions";

function Fields({ et }: { et?: EventType }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 text-sm">
        Name
        <input
          name="name"
          required
          defaultValue={et?.name}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="col-span-2 text-sm">
        Description
        <textarea
          name="description"
          defaultValue={et?.description}
          rows={2}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Duration (min)
        <input
          name="duration_min"
          type="number"
          min={5}
          max={480}
          defaultValue={et?.duration_min ?? 30}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Buffer around (min)
        <input
          name="buffer_min"
          type="number"
          min={0}
          max={120}
          defaultValue={et?.buffer_min ?? 0}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Min notice (min)
        <input
          name="min_notice_min"
          type="number"
          min={0}
          max={10080}
          defaultValue={et?.min_notice_min ?? 120}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="text-sm">
        Bookable window (days)
        <input
          name="window_days"
          type="number"
          min={1}
          max={365}
          defaultValue={et?.window_days ?? 30}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="col-span-2 text-sm">
        Meeting link (optional)
        <input
          name="meeting_url"
          type="url"
          defaultValue={et?.meeting_url}
          placeholder="https://acme.webex.com/meet/you"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <span className="mt-1 block text-xs text-gray-400">
          Paste your Webex Personal Room (or Zoom/Teams/Meet) link — it goes in
          every booking’s calendar invite and emails as the join link.
        </span>
      </label>
      {et && (
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={et.active === 1} />
          Active (visible on your booking page)
        </label>
      )}
    </div>
  );
}

export default async function EventTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const host = await requireHost();
  const eventTypes = db
    .prepare("SELECT * FROM event_types WHERE host_id = ? ORDER BY id")
    .all(host.id) as EventType[];

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-bold">Event types</h1>
      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {eventTypes.map((et) => (
        <details key={et.id} className="rounded-xl border border-gray-200 p-4">
          <summary className="cursor-pointer font-semibold">
            {et.name}{" "}
            <span className="text-sm font-normal text-gray-500">
              · {et.duration_min} min · /book/{host.slug}/{et.slug}
              {et.active === 0 && " · inactive"}
            </span>
          </summary>
          <form action={updateEventType} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={et.id} />
            <Fields et={et} />
            <div className="flex gap-3">
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                Save
              </button>
              <button
                formAction={deleteEventType}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </form>
        </details>
      ))}

      <details className="rounded-xl border border-dashed border-gray-300 p-4">
        <summary className="cursor-pointer font-semibold text-blue-600">
          + New event type
        </summary>
        <form action={createEventType} className="mt-4 space-y-4">
          <Fields />
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            Create
          </button>
        </form>
      </details>
    </main>
  );
}
