import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import db, { TeamEventType } from "@/lib/db";
import { teamBySlug, teamMembers } from "@/lib/teams";
import { pickLocale, t } from "@/lib/i18n";
import BookingWidget from "@/app/book/[slug]/[eventSlug]/BookingWidget";

export default async function TeamEventBookingPage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const locale = pickLocale((await headers()).get("accept-language"));
  const team = teamBySlug(slug);
  if (!team) notFound();
  const eventType = db
    .prepare(
      "SELECT * FROM team_event_types WHERE team_id = ? AND slug = ? AND active = 1"
    )
    .get(team.id, eventSlug) as TeamEventType | undefined;
  if (!eventType) notFound();
  const members = teamMembers(team.id);
  if (members.length === 0) notFound();

  // The widget's "host time" hints use the team's dominant timezone.
  const tzCounts = new Map<string, number>();
  for (const m of members) tzCounts.set(m.timezone, (tzCounts.get(m.timezone) ?? 0) + 1);
  const teamTz = [...tzCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return (
    <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-14">
      <Link
        href={`/team/${team.slug}`}
        className="font-mono text-xs uppercase tracking-[0.15em] text-ink/50 hover:text-ink"
      >
        ← {t(locale, "allMeetingTypes")}
      </Link>
      <p className="mt-5 font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {team.name}
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
      <p className="mt-1 text-sm text-ink/50">{t(locale, "teamMatched")}</p>
      <div className="day-arc mt-5 w-24" />
      <div className="mt-8">
        <BookingWidget
          teamEventTypeId={eventType.id}
          durationMin={eventType.duration_min}
          windowDays={eventType.window_days}
          hostName={team.name}
          hostTimezone={teamTz}
          locale={locale}
        />
      </div>
    </main>
  );
}
