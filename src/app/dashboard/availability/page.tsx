import db, { AvailabilityRule } from "@/lib/db";
import { requireHost } from "@/lib/session";
import { saveAvailability, updateTimezone } from "@/lib/actions";
import RulesEditor from "./RulesEditor";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const host = await requireHost();
  const rules = db
    .prepare(
      "SELECT * FROM availability_rules WHERE host_id = ? ORDER BY weekday, start_min"
    )
    .all(host.id) as AvailabilityRule[];

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-bold">Availability</h1>
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
        <h2 className="font-semibold mb-2">Timezone</h2>
        <form action={updateTimezone} className="flex gap-2 items-center">
          <input
            name="timezone"
            defaultValue={host.timezone}
            className="rounded-lg border border-gray-300 px-3 py-2 w-72 font-mono text-sm"
          />
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
            Update
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          IANA name, e.g. America/Montreal. Your weekly hours below are in this timezone.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold mb-4">Weekly hours</h2>
        <RulesEditor
          initialRules={rules.map((r) => ({
            weekday: r.weekday,
            start_min: r.start_min,
            end_min: r.end_min,
          }))}
          saveAction={saveAvailability}
        />
      </section>
    </main>
  );
}
