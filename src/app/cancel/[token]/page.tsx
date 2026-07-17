import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import db, { Booking, EventType, Host } from "@/lib/db";
import { sendBookingEmails } from "@/lib/email";
import { deleteOutlookEvent } from "@/lib/msgraph";
import { deleteWebexMeeting } from "@/lib/webex";

async function cancelAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") || "");
  const booking = db
    .prepare("SELECT * FROM bookings WHERE cancel_token = ? AND status = 'confirmed'")
    .get(token) as Booking | undefined;
  if (!booking) return;
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(booking.host_id) as Host;
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(booking.event_type_id) as EventType;
  if (booking.ms_event_id) await deleteOutlookEvent(host.id, booking.ms_event_id);
  if (booking.webex_meeting_id) await deleteWebexMeeting(host.id, booking.webex_meeting_id);
  await sendBookingEmails({ ...booking, status: "cancelled" }, host, eventType, "cancelled");
  revalidatePath(`/cancel/${token}`);
}

export default async function CancelPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = db
    .prepare("SELECT * FROM bookings WHERE cancel_token = ?")
    .get(token) as Booking | undefined;
  if (!booking) notFound();
  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(booking.host_id) as Host;
  const eventType = db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(booking.event_type_id) as EventType;

  const when = DateTime.fromISO(booking.start_utc, { zone: "utc" })
    .setZone(booking.guest_timezone)
    .toFormat("cccc, LLLL d yyyy 'at' h:mm a (ZZZZ)");

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-white p-8 space-y-4">
        <div className="day-arc w-full" />
        <h1 className="text-2xl font-semibold text-ink">
          {booking.status === "cancelled" ? "Booking cancelled" : "Cancel this booking?"}
        </h1>
        <div className="text-sm text-ink/70 space-y-1">
          <p>
            <span className="font-semibold text-ink">{eventType.name}</span> with {host.name}
          </p>
          <p className="font-mono">{when}</p>
          <p>
            {booking.guest_name} · {booking.guest_email}
          </p>
        </div>
        {booking.status === "confirmed" ? (
          <form action={cancelAction}>
            <input type="hidden" name="token" value={token} />
            <button className="w-full rounded-lg bg-ink px-4 py-2.5 font-semibold text-paper hover:opacity-90">
              Cancel this booking
            </button>
          </form>
        ) : (
          <p className="text-sm text-ink/70 bg-paper border border-ink/10 rounded-md px-3 py-2">
            This time is freed up. If you need a new one, book again from the
            original link.
          </p>
        )}
      </div>
    </main>
  );
}
