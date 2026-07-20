import Link from "next/link";
import { headers } from "next/headers";
import { login } from "@/lib/actions";
import { pickLocale, t } from "@/lib/i18n";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const locale = pickLocale((await headers()).get("accept-language"));
  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <form action={login} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{t(locale, "login_title")}</h1>
        {error && (
          <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <input
          name="email"
          type="email"
          required
          placeholder={t(locale, "email")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder={t(locale, "password")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700">
          {t(locale, "logIn")}
        </button>
        <p className="text-sm text-gray-500">
          {t(locale, "noAccount")}{" "}
          <Link href="/signup" className="text-blue-600 hover:underline">
            {t(locale, "signUp")}
          </Link>
        </p>
      </form>
    </main>
  );
}
