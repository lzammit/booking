import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import db, { Booking, EventType, Host } from "@/lib/db";
import { sendBookingEmails } from "@/lib/email";
import { deleteOutlookEvent } from "@/lib/msgraph";

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
      <div className="w-full max-w-md rounded-xl border border-gray-200 p-6 space-y-4">
        <h1 className="text-xl font-bold">
          {booking.status === "cancelled" ? "Booking cancelled" : "Cancel this booking?"}
        </h1>
        <div className="text-sm text-gray-600 space-y-1">
          <p>
            <span className="font-medium">{eventType.name}</span> with {host.name}
          </p>
          <p>{when}</p>
          <p>
            {booking.guest_name} · {booking.guest_email}
          </p>
        </div>
        {booking.status === "confirmed" ? (
          <form action={cancelAction}>
            <input type="hidden" name="token" value={token} />
            <button className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-white font-medium hover:bg-red-700">
              Cancel booking
            </button>
          </form>
        ) : (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            This booking has been cancelled.
          </p>
        )}
      </div>
    </main>
  );
}
