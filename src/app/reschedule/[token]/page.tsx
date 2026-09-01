import Link from "next/link";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import db, { Booking, EventType, Host } from "@/lib/db";
import { Locale, pickLocale, t } from "@/lib/i18n";
import { getSession } from "@/lib/session";
import { hostFreeReschedule } from "@/lib/actions";
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

  // The booking's own host gets a free-move panel: any future time, no
  // window/notice/availability constraints.
  const session = await getSession();
  const isOwner = session.hostId === booking.host_id;
  const currentHostLocal = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(host.timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm");

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
      {isOwner && (
        <div className="mt-6 rounded-xl border border-ink/10 bg-white p-4">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-ink/50">
            Host move — no restrictions
          </p>
          <p className="mt-1 text-sm text-ink/60">
            Put it anywhere: outside your hours, past the booking window, even over
            another meeting (you&apos;ll get a warning, not a block). The guest is
            notified and their invite updates. Time below is yours ({host.timezone.replace(/_/g, " ")}).
          </p>
          <form action={hostFreeReschedule} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={booking.id} />
            <input
              type="datetime-local"
              name="newstart"
              required
              defaultValue={currentHostLocal}
              className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm"
            />
            <button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90">
              Move it there
            </button>
          </form>
        </div>
      )}
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
