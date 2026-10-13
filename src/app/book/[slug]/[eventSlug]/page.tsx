import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import db, { EventType, hostBySlug, questionList } from "@/lib/db";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { slug, eventSlug } = await params;
  const resolved = hostBySlug(slug);
  if (!resolved) return {};
  const et = db
    .prepare("SELECT name, description, duration_min FROM event_types WHERE host_id = ? AND slug = ? AND active = 1")
    .get(resolved.host.id, eventSlug) as
    | { name: string; description: string; duration_min: number }
    | undefined;
  if (!et) return {};
  const title = `${et.name} — ${resolved.host.name}`;
  const description =
    et.description ||
    `Book a ${et.duration_min} minute meeting with ${resolved.host.name}. Pick any open slot; confirmation and calendar invite arrive by email.`;
  return {
    title,
    description,
    alternates: { canonical: `/book/${resolved.host.slug}/${eventSlug}` },
    openGraph: { title, description, url: `/book/${resolved.host.slug}/${eventSlug}` },
  };
}
import { pickLocale, t } from "@/lib/i18n";
import SiteFooter from "@/app/SiteFooter";
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
    <>
      <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-14">
        <Link
          href={`/book/${host.slug}`}
          className="font-mono text-xs uppercase tracking-[0.15em] text-ink/70 hover:text-ink"
        >
          ← {t(locale, "allMeetingTypes")}
        </Link>
        <p className="mt-5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/70">
          {host.name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          {eventType.name}
        </h1>
        <p className="mt-1 text-ink/70">
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
            questions={questionList(eventType.questions)}
          />
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
