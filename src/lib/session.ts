import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import db, { Host } from "./db";

export interface SessionData {
  hostId?: number;
}

/** The one cookie this site sets, and only for logged-in hosts. */
export const SESSION_COOKIE_NAME = "booking_session";
/** Session lifetime; quoted on /privacy, so keep it in sync with ttl below. */
export const SESSION_TTL_DAYS = 14;

const sessionPassword = process.env.SESSION_SECRET;
if (!sessionPassword || sessionPassword.length < 32) {
  throw new Error("SESSION_SECRET env var must be set (32+ chars)");
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, {
    password: sessionPassword as string,
    cookieName: SESSION_COOKIE_NAME,
    ttl: 60 * 60 * 24 * SESSION_TTL_DAYS,
    cookieOptions: {
      // Secure cookies only once the app is actually served over HTTPS.
      secure: (process.env.APP_URL || "").startsWith("https://"),
      httpOnly: true,
      sameSite: "lax",
    },
  });
}

export async function currentHost(): Promise<Host | null> {
  const session = await getSession();
  if (!session.hostId) return null;
  const host = db
    .prepare("SELECT * FROM hosts WHERE id = ?")
    .get(session.hostId) as Host | undefined;
  return host ?? null;
}

export async function requireHost(): Promise<Host> {
  const host = await currentHost();
  if (!host) redirect("/login");
  return host;
}

export async function requireAdmin(): Promise<Host> {
  const host = await requireHost();
  if (!host.is_admin) redirect("/dashboard");
  return host;
}
