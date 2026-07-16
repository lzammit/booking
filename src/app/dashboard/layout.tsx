import Link from "next/link";
import { requireHost } from "@/lib/session";
import { logout } from "@/lib/actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = await requireHost();
  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-gray-200">
        <nav className="mx-auto max-w-4xl flex items-center gap-6 px-6 py-3 text-sm">
          <Link href="/dashboard" className="font-bold text-base">
            Booking
          </Link>
          <Link href="/dashboard" className="text-gray-600 hover:text-black">
            Bookings
          </Link>
          <Link href="/dashboard/event-types" className="text-gray-600 hover:text-black">
            Event types
          </Link>
          <Link href="/dashboard/availability" className="text-gray-600 hover:text-black">
            Availability
          </Link>
          <Link href="/dashboard/settings" className="text-gray-600 hover:text-black">
            Settings
          </Link>
          {host.is_admin === 1 && (
            <Link href="/dashboard/admin" className="text-gray-600 hover:text-black">
              Admin
            </Link>
          )}
          <span className="flex-1" />
          <Link href={`/book/${host.slug}`} className="text-blue-600 hover:underline">
            /book/{host.slug}
          </Link>
          <form action={logout}>
            <button className="text-gray-500 hover:text-black">Log out</button>
          </form>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl px-6 py-8">{children}</div>
    </div>
  );
}
