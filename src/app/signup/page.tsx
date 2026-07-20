import Link from "next/link";
import { headers } from "next/headers";
import { signup } from "@/lib/actions";
import { signupCode } from "@/lib/db";
import { pickLocale, t } from "@/lib/i18n";
import TimezoneField from "./TimezoneField";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invite?: string; email?: string }>;
}) {
  const { error, invite, email } = await searchParams;
  const locale = pickLocale((await headers()).get("accept-language"));
  // Show the code field when a signup code is required, or when the visitor
  // arrived with a code in the link (e.g. an admin onboarding link) so it can
  // be submitted even if regular signup is otherwise open.
  const needsInvite = Boolean(signupCode()) || Boolean(invite);
  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <form action={signup} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{t(locale, "signup_title")}</h1>
        {error && (
          <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <input
          name="name"
          required
          placeholder={t(locale, "fullName")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          name="email"
          type="email"
          required
          defaultValue={email}
          placeholder={t(locale, "email")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder={t(locale, "passwordHint")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <TimezoneField hintTemplate={t(locale, "tzHint", { tz: "{tz}" })} />
        {needsInvite && (
          <input
            name="invite"
            required
            defaultValue={invite}
            placeholder={t(locale, "inviteCode")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        )}
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700">
          {t(locale, "signUp")}
        </button>
        <p className="text-sm text-gray-500">
          {t(locale, "haveAccount")}{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            {t(locale, "logIn")}
          </Link>
        </p>
      </form>
    </main>
  );
}
