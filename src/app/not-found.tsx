import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        404 · unscheduled
      </p>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink">
        This time doesn’t exist
      </h1>
      <div className="day-arc w-24" />
      <p className="max-w-md text-ink/60">
        You’ve landed in a gap on the calendar — no host, no meeting, just open
        space between dawn and dusk. Nobody’s free here, because there’s no
        <span className="whitespace-nowrap"> “here” </span> to be free in.
      </p>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-ink/40">
        <span className="h-2 w-2 rounded-full bg-dawn" />
        <span className="h-2 w-2 rounded-full bg-noon" />
        <span className="h-2 w-2 rounded-full bg-dusk" />
        no slots found
      </div>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-ink px-5 py-2.5 font-semibold text-paper hover:opacity-90"
      >
        Find a time that does →
      </Link>
    </main>
  );
}
