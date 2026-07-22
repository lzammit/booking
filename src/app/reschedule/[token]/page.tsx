import Link from "next/link";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import db, { Booking, EventType, Host } from "@/lib/db";
import { Locale, pickLocale, t } from "@/lib/i18n";
import BookingWidget from "../../book/[slug]/[eventSlug]/BookingWidget";

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const booking = db
    .prepare("SELECT * FROM bookings WHERE cancel_token = ?")
    .get(token) as Booking | undefined;
  if (!booking) notFound();
  // A cancelled booking can't be moved — send them to the status page.
  if (booking.status !== "confirmed") redirect(`/cancel/${token}`);
  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(booking.host_id) as Host;
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(booking.event_type_id) as EventType;

  const current = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(booking.guest_timezone)
    .setLocale(locale)
    .toLocaleString({
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

  return (
    <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-14">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {host.name}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
        {t(locale, "rescheduleTitle")}
      </h1>
      <p className="mt-1 text-ink/60">
        {t(locale, "withHost", { event: eventType.name, host: host.name })}
      </p>
      <p className="mt-2 font-mono text-sm text-ink/50">
        {t(locale, "currentlyScheduled", { when: current })}
      </p>
      <p className="mt-1 text-sm">
        <Link href={`/cancel/${token}`} className="text-ink/50 underline underline-offset-4 hover:text-ink">
          {t(locale, "cancelButton")}
        </Link>
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
          rescheduleToken={token}
        />
      </div>
    </main>
  );
}
