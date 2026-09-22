import Link from "next/link";
import { Locale, t } from "@/lib/i18n";

/**
 * Legal links under every public page (landing, /book, /team, /cancel,
 * /reschedule and the legal pages themselves). Sits after the flex-1 <main>,
 * so it lands at the bottom of short pages without pinning.
 */
export default function SiteFooter({ locale }: { locale: Locale }) {
  const linkClass =
    "rounded-sm text-ink/70 underline-offset-4 hover:text-ink hover:underline";
  return (
    <footer className="mx-auto w-full max-w-3xl px-6 pb-8 pt-10">
      <nav aria-label={t(locale, "footer_nav")}>
        <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.15em]">
          <li>
            <Link href="/legal" className={linkClass}>
              {t(locale, "footer_legal")}
            </Link>
          </li>
          <li aria-hidden className="text-ink/30">
            ·
          </li>
          <li>
            <Link href="/privacy" className={linkClass}>
              {t(locale, "footer_privacy")}
            </Link>
          </li>
          <li aria-hidden className="text-ink/30">
            ·
          </li>
          <li>
            <Link href="/terms" className={linkClass}>
              {t(locale, "footer_terms")}
            </Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
