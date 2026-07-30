import Link from "next/link";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/actions";
import { pickLocale, t } from "@/lib/i18n";

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const locale = pickLocale((await headers()).get("accept-language"));
  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{t(locale, "forgot_title")}</h1>
        {sent ? (
          <>
            <p className="rounded-md bg-green-50 border border-green-200 text-green-700 px-3 py-2 text-sm">
              {t(locale, "forgot_sent")}
            </p>
            <p className="text-sm">
              <Link href="/login" className="text-blue-600 hover:underline">
                {t(locale, "backToLogin")}
              </Link>
            </p>
          </>
        ) : (
          <form action={requestPasswordReset} className="space-y-4">
            <p className="text-sm text-gray-500">{t(locale, "forgot_intro")}</p>
            <input
              name="email"
              type="email"
              required
              placeholder={t(locale, "email")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700">
              {t(locale, "forgot_button")}
            </button>
            <p className="text-sm">
              <Link href="/login" className="text-blue-600 hover:underline">
                {t(locale, "backToLogin")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
