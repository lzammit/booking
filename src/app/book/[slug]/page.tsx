import Link from "next/link";
import { notFound } from "next/navigation";
import db, { EventType, Host } from "@/lib/db";

export default async function HostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const host = db.prepare("SELECT * FROM hosts WHERE slug = ?").get(slug) as
    | Host
    | undefined;
  if (!host) notFound();
  const eventTypes = db
    .prepare("SELECT * FROM event_types WHERE host_id = ? AND active = 1 ORDER BY duration_min")
    .all(host.id) as EventType[];

  return (
    <main className="flex-1 mx-auto w-full max-w-lg px-6 py-16 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{host.name}</h1>
        <p className="text-gray-500">Pick a meeting type to see available times.</p>
      </div>
      <ul className="space-y-3">
        {eventTypes.map((et) => (
          <li key={et.id}>
            <Link
              href={`/book/${host.slug}/${et.slug}`}
              className="block rounded-xl border border-gray-200 p-4 hover:border-blue-400 hover:shadow-sm transition"
            >
              <div className="font-semibold">{et.name}</div>
              <div className="text-sm text-gray-500">
                {et.duration_min} min
                {et.description && <> · {et.description}</>}
              </div>
            </Link>
          </li>
        ))}
        {eventTypes.length === 0 && (
          <p className="text-gray-500">No bookable event types right now.</p>
        )}
      </ul>
    </main>
  );
}
