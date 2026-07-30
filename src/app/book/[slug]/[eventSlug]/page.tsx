import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import db, { EventType, hostBySlug } from "@/lib/db";
import { pickLocale, t } from "@/lib/i18n";
import BookingWidget from "./BookingWidget";

export default async function EventBookingPage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const locale = pickLocale((await headers()).get("accept-language"));
  const resolved = hostBySlug(slug);
  if (!resolved) notFound();
  const { host, aliased } = resolved;
  // Old (renamed) link — preserve the chosen event type, current slug.
  if (aliased) redirect(`/book/${host.slug}/${eventSlug}`);
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
        ← {t(locale, "allMeetingTypes")}
      </Link>
      <p className="mt-5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {host.name}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
        {eventType.name}
      </h1>
      <p className="mt-1 text-ink/60">
        <span className="font-mono tabular-nums">
          {eventType.duration_min} {t(locale, "min")}
        </span>
        {eventType.description && <> · {eventType.description}</>}
      </p>
      <div className="day-arc mt-5 w-24" />
      <div className="mt-8">
        <BookingWidget
          eventTypeId={eventType.id}
          durationMin={eventType.duration_min}
          windowDays={eventType.window_days}
          hostName={host.name}
          hostTimezone={host.timezone}
          locale={locale}
        />
      </div>
    </main>
  );
}
