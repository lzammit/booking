import { notFound } from "next/navigation";
import Link from "next/link";
import db, { EventType, Host } from "@/lib/db";
import BookingWidget from "./BookingWidget";

export default async function EventBookingPage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const host = db.prepare("SELECT * FROM hosts WHERE slug = ?").get(slug) as
    | Host
    | undefined;
  if (!host) notFound();
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE host_id = ? AND slug = ? AND active = 1")
    .get(host.id, eventSlug) as EventType | undefined;
  if (!eventType) notFound();

  return (
    <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-12 space-y-6">
      <div>
        <Link href={`/book/${host.slug}`} className="text-sm text-blue-600 hover:underline">
          ← {host.name}
        </Link>
        <h1 className="text-2xl font-bold mt-1">{eventType.name}</h1>
        <p className="text-gray-500">
          {eventType.duration_min} min
          {eventType.description && <> · {eventType.description}</>}
        </p>
      </div>
      <BookingWidget
        eventTypeId={eventType.id}
        durationMin={eventType.duration_min}
        windowDays={eventType.window_days}
        hostName={host.name}
      />
    </main>
  );
}
