import Link from "next/link";
import { currentHost } from "@/lib/session";

export default async function Home() {
  const host = await currentHost();
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        Meeting scheduling
      </p>
      <h1 className="text-5xl font-semibold tracking-tight text-ink">Booking</h1>
      <div className="day-arc w-24" />
      <p className="max-w-md text-ink/60">
        Share one link. People pick a time that fits both calendars — morning,
        midday, or evening.
      </p>
      <div className="flex gap-3">
        {host ? (
          <Link
            href="/dashboard"
            className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-paper hover:opacity-90"
          >
            Open dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-paper hover:opacity-90"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg border border-ink/15 px-5 py-2.5 font-semibold text-ink hover:border-ink"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
