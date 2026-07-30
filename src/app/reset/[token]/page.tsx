import Link from "next/link";
import { headers } from "next/headers";
import { resetPassword, resetTokenHostId } from "@/lib/actions";
import { pickLocale, t } from "@/lib/i18n";

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const locale = pickLocale((await headers()).get("accept-language"));
  const valid = (await resetTokenHostId(token)) !== null;

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{t(locale, "reset_title")}</h1>
        {!valid ? (
          <>
            <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
              {t(locale, "reset_invalid")}
            </p>
            <p className="text-sm">
              <Link href="/forgot" className="text-blue-600 hover:underline">
                {t(locale, "forgot_title")}
              </Link>
            </p>
          </>
        ) : (
          <form action={resetPassword} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            {error === "short" && (
              <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {t(locale, "passwordHint")}
              </p>
            )}
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder={t(locale, "newPassword")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700">
              {t(locale, "reset_button")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
