import { DateTime, Interval } from "luxon";
import db, { getSetting } from "./db";

/**
 * Microsoft 365 calendar integration via Microsoft Graph.
 * Fully optional: if the integration isn't configured or a host hasn't
 * connected their account, every function degrades to a no-op.
 *
 * Client credentials come from the admin UI (settings table), falling back to
 * MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID env vars. Register an app at
 * https://portal.azure.com (Azure AD → App registrations) with the redirect
 * URI from msRedirectUri() and the delegated scopes in MS_SCOPES.
 */

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export const MS_SCOPES = "offline_access User.Read Calendars.ReadWrite";

function tenant(): string {
  return getSetting("ms_tenant_id") || process.env.MS_TENANT_ID || "common";
}
function clientId(): string {
  return getSetting("ms_client_id") ?? process.env.MS_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return getSetting("ms_client_secret") ?? process.env.MS_CLIENT_SECRET ?? "";
}

export function msConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function msRedirectUri(): string {
  return `${APP_URL}/api/ms/callback`;
}

export function msAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: msRedirectUri(),
    response_mode: "query",
    scope: MS_SCOPES,
    state,
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params}`;
}

interface TokenRow {
  host_id: number;
  account_email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        scope: MS_SCOPES,
        ...body,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`MS token endpoint ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function msExchangeCode(hostId: number, code: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: msRedirectUri(),
  });
  // Look up the connected account's email for display.
  let email = "";
  try {
    const me = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (me.ok) {
      const j = (await me.json()) as { mail?: string; userPrincipalName?: string };
      email = j.mail || j.userPrincipalName || "";
    }
  } catch {
    /* display-only */
  }
  db.prepare(
    `INSERT INTO ms_tokens (host_id, account_email, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(host_id) DO UPDATE SET account_email=excluded.account_email,
       access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       expires_at=excluded.expires_at`
  ).run(
    hostId,
    email,
    tokens.access_token,
    tokens.refresh_token ?? "",
    Math.floor(Date.now() / 1000) + tokens.expires_in
  );
}

export function msAccountFor(hostId: number): string | null {
  const row = db
    .prepare("SELECT account_email FROM ms_tokens WHERE host_id = ?")
    .get(hostId) as { account_email: string } | undefined;
  return row ? row.account_email || "connected" : null;
}

export function msDisconnect(hostId: number) {
  db.prepare("DELETE FROM ms_tokens WHERE host_id = ?").run(hostId);
}

async function getAccessToken(hostId: number): Promise<string | null> {
  if (!msConfigured()) return null;
  const row = db
    .prepare("SELECT * FROM ms_tokens WHERE host_id = ?")
    .get(hostId) as TokenRow | undefined;
  if (!row) return null;
  if (row.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return row.access_token;
  }
  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    });
    db.prepare(
      "UPDATE ms_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE host_id=?"
    ).run(
      tokens.access_token,
      tokens.refresh_token ?? row.refresh_token,
      Math.floor(Date.now() / 1000) + tokens.expires_in,
      hostId
    );
    return tokens.access_token;
  } catch (err) {
    console.error(`MS token refresh failed for host ${hostId}:`, err);
    return null;
  }
}

/** Busy intervals from the host's Outlook calendar; [] when not connected or on error. */
export async function getBusyIntervals(
  hostId: number,
  fromUtc: DateTime,
  toUtc: DateTime
): Promise<Interval[]> {
  const token = await getAccessToken(hostId);
  if (!token) return [];
  try {
    const params = new URLSearchParams({
      startDateTime: fromUtc.toISO()!,
      endDateTime: toUtc.toISO()!,
      $select: "start,end,showAs",
      $top: "500",
    });
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
      { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } }
    );
    if (!res.ok) {
      console.error(`MS calendarView ${res.status}: ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as {
      value: { start: { dateTime: string }; end: { dateTime: string }; showAs: string }[];
    };
    return data.value
      .filter((e) => e.showAs !== "free")
      .map((e) =>
        Interval.fromDateTimes(
          DateTime.fromISO(e.start.dateTime, { zone: "utc" }),
          DateTime.fromISO(e.end.dateTime, { zone: "utc" })
        )
      )
      .filter((i) => i.isValid);
  } catch (err) {
    console.error("MS getBusyIntervals failed:", err);
    return [];
  }
}

/** Create the meeting in the host's Outlook calendar. Returns the event id, or null. */
export async function createOutlookEvent(args: {
  hostId: number;
  subject: string;
  body: string;
  startUtc: string;
  endUtc: string;
  guestName: string;
  guestEmail: string;
}): Promise<string | null> {
  const token = await getAccessToken(args.hostId);
  if (!token) return null;
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: args.subject,
        body: { contentType: "text", content: args.body },
        start: { dateTime: args.startUtc, timeZone: "UTC" },
        end: { dateTime: args.endUtc, timeZone: "UTC" },
        attendees: [
          {
            emailAddress: { address: args.guestEmail, name: args.guestName },
            type: "required",
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`MS create event ${res.status}: ${await res.text()}`);
      return null;
    }
    const j = (await res.json()) as { id: string };
    return j.id;
  } catch (err) {
    console.error("MS createOutlookEvent failed:", err);
    return null;
  }
}

/** Delete the Outlook event on cancellation (best effort). */
export async function deleteOutlookEvent(hostId: number, eventId: string) {
  const token = await getAccessToken(hostId);
  if (!token) return;
  try {
    await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("MS deleteOutlookEvent failed:", err);
  }
}
