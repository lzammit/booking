import Link from "next/link";
import { currentHost } from "@/lib/session";

export default async function Home() {
  const host = await currentHost();
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Booking</h1>
      <p className="text-lg text-gray-500 max-w-md text-center">
        Share your link, let people pick a time. Synced with your calendar.
      </p>
      <div className="flex gap-3">
        {host ? (
          <Link
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-white font-medium hover:bg-blue-700"
          >
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-white font-medium hover:bg-blue-700"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium hover:bg-gray-50"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
