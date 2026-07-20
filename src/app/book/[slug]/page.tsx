import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import db, { EventType, Host } from "@/lib/db";
import { pickLocale, t } from "@/lib/i18n";

export default async function HostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = pickLocale((await headers()).get("accept-language"));
  const host = db.prepare("SELECT * FROM hosts WHERE slug = ?").get(slug) as
    | Host
    | undefined;
  if (!host) notFound();
  const eventTypes = db
    .prepare("SELECT * FROM event_types WHERE host_id = ? AND active = 1 ORDER BY duration_min")
    .all(host.id) as EventType[];

  return (
    <main className="flex-1 mx-auto w-full max-w-xl px-6 py-20">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {t(locale, "bookTimeWith")}
      </p>
      <h1 className="mt-2 text-4xl sm:text-5xl font-semibold tracking-tight text-ink">
        {host.name}
      </h1>
      <div className="day-arc mt-6 w-24" />
      <p className="mt-6 text-ink/60">{t(locale, "pickMeetingIntro")}</p>

      <ul className="mt-10 space-y-3">
        {eventTypes.map((et) => (
          <li key={et.id}>
            <Link
              href={`/book/${host.slug}/${et.slug}`}
              className="group flex items-baseline gap-5 rounded-xl border border-ink/10 bg-white px-6 py-5 transition hover:border-ink hover:shadow-[0_2px_0_0_var(--ink)]"
            >
              <span className="font-mono text-2xl font-medium tabular-nums text-ink">
                {et.duration_min}
                <span className="ml-1 text-xs text-ink/40">{t(locale, "min")}</span>
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-ink group-hover:underline underline-offset-4">
                  {et.name}
                </span>
                {et.description && (
                  <span className="block text-sm text-ink/50">{et.description}</span>
                )}
              </span>
              <span aria-hidden className="text-ink/30 transition group-hover:translate-x-1 group-hover:text-ink">
                →
              </span>
            </Link>
          </li>
        ))}
        {eventTypes.length === 0 && (
          <p className="text-ink/50">{t(locale, "nothingOpen")}</p>
        )}
      </ul>
    </main>
  );
}
