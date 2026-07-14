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
    <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-14">
      <Link
        href={`/book/${host.slug}`}
        className="font-mono text-xs uppercase tracking-[0.15em] text-ink/50 hover:text-ink"
      >
        ← All meeting types
      </Link>
      <p className="mt-5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {host.name}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
        {eventType.name}
      </h1>
      <p className="mt-1 text-ink/60">
        <span className="font-mono tabular-nums">{eventType.duration_min} min</span>
        {eventType.description && <> · {eventType.description}</>}
      </p>
      <div className="day-arc mt-5 w-24" />
      <div className="mt-8">
        <BookingWidget
          eventTypeId={eventType.id}
          durationMin={eventType.duration_min}
          windowDays={eventType.window_days}
          hostName={host.name}
        />
      </div>
    </main>
  );
}
