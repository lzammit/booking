import Link from "next/link";
import { headers } from "next/headers";
import { pickLocale, t } from "@/lib/i18n";

export default async function NotFound() {
  const locale = pickLocale((await headers()).get("accept-language"));
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/50">
        {t(locale, "nf_eyebrow")}
      </p>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink">
        {t(locale, "nf_title")}
      </h1>
      <div className="day-arc w-24" />
      <p className="max-w-md text-ink/60">{t(locale, "nf_text")}</p>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-ink/40">
        <span className="h-2 w-2 rounded-full bg-dawn" />
        <span className="h-2 w-2 rounded-full bg-noon" />
        <span className="h-2 w-2 rounded-full bg-dusk" />
        {t(locale, "nf_noSlots")}
      </div>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-ink px-5 py-2.5 font-semibold text-paper hover:opacity-90"
      >
        {t(locale, "nf_cta")}
      </Link>
    </main>
  );
}
