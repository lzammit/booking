import Link from "next/link";
import { signup } from "@/lib/actions";
import { signupCode } from "@/lib/db";
import TimezoneField from "./TimezoneField";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invite?: string; email?: string }>;
}) {
  const { error, invite, email } = await searchParams;
  const needsInvite = Boolean(signupCode());
  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <form action={signup} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Create your account</h1>
        {error && (
          <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <input
          name="name"
          required
          placeholder="Full name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          name="email"
          type="email"
          required
          defaultValue={email}
          placeholder="Email"
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Password (8+ characters)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <TimezoneField />
        {needsInvite && (
          <input
            name="invite"
            required
            defaultValue={invite}
            placeholder="Invite code"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        )}
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white font-medium hover:bg-blue-700">
          Sign up
        </button>
        <p className="text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
