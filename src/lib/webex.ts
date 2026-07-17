import db, { getSetting } from "./db";

/**
 * Cisco Webex meeting integration.
 * Fully optional: if the integration isn't configured or a host hasn't
 * connected their Webex account, every function degrades to a no-op —
 * bookings still succeed, just without a generated meeting link.
 *
 * The OAuth integration's client credentials come from the admin UI
 * (settings table), falling back to WEBEX_CLIENT_ID / WEBEX_CLIENT_SECRET
 * env vars. Register the integration at https://developer.webex.com/my-apps
 * with the redirect URI from webexRedirectUri() and the scopes in SCOPES.
 */

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Minimal, self-scoped: create/cancel your own meetings, and read them back.
// (No people/directory scope — keeps the consent screen benign for corporate
// approval. Without it /people/me can't return the email, so the connected
// account shows as "Connected" rather than by address.)
export const WEBEX_SCOPES =
  "meeting:schedules_write meeting:schedules_read";
const API = "https://webexapis.com/v1";

function clientId(): string {
  return getSetting("webex_client_id") ?? process.env.WEBEX_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return getSetting("webex_client_secret") ?? process.env.WEBEX_CLIENT_SECRET ?? "";
}

export function webexConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function webexRedirectUri(): string {
  return `${APP_URL}/api/webex/callback`;
}

export function webexAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: webexRedirectUri(),
    scope: WEBEX_SCOPES,
    state,
  });
  return `${API}/authorize?${params}`;
}

interface TokenRow {
  host_id: number;
  account_email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${API}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      ...body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Webex token endpoint ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function webexExchangeCode(hostId: number, code: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: webexRedirectUri(),
  });
  let email = "";
  try {
    const me = await fetch(`${API}/people/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (me.ok) {
      const j = (await me.json()) as { emails?: string[]; displayName?: string };
      email = j.emails?.[0] || j.displayName || "";
    }
  } catch {
    /* display-only */
  }
  db.prepare(
    `INSERT INTO webex_tokens (host_id, account_email, access_token, refresh_token, expires_at)
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

export function webexAccountFor(hostId: number): string | null {
  const row = db
    .prepare("SELECT account_email FROM webex_tokens WHERE host_id = ?")
    .get(hostId) as { account_email: string } | undefined;
  return row ? row.account_email || "connected" : null;
}

export function webexDisconnect(hostId: number) {
  db.prepare("DELETE FROM webex_tokens WHERE host_id = ?").run(hostId);
}

async function getAccessToken(hostId: number): Promise<string | null> {
  if (!webexConfigured()) return null;
  const row = db
    .prepare("SELECT * FROM webex_tokens WHERE host_id = ?")
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
      "UPDATE webex_tokens SET access_token=?, refresh_token=?, expires_at=? WHERE host_id=?"
    ).run(
      tokens.access_token,
      tokens.refresh_token ?? row.refresh_token,
      Math.floor(Date.now() / 1000) + tokens.expires_in,
      hostId
    );
    return tokens.access_token;
  } catch (err) {
    console.error(`Webex token refresh failed for host ${hostId}:`, err);
    return null;
  }
}

/** Schedule a Webex meeting. Returns {link, meetingId} or null on any failure. */
export async function createWebexMeeting(args: {
  hostId: number;
  title: string;
  agenda: string;
  startUtc: string;
  endUtc: string;
  guestEmail: string;
}): Promise<{ link: string; meetingId: string } | null> {
  const token = await getAccessToken(args.hostId);
  if (!token) return null;
  try {
    const res = await fetch(`${API}/meetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: args.title,
        agenda: args.agenda.slice(0, 1300),
        start: args.startUtc,
        end: args.endUtc,
        timezone: "UTC",
        enabledAutoRecordMeeting: false,
        invitees: [{ email: args.guestEmail }],
      }),
    });
    if (!res.ok) {
      console.error(`Webex create meeting ${res.status}: ${await res.text()}`);
      return null;
    }
    const j = (await res.json()) as { id: string; webLink: string };
    return { link: j.webLink, meetingId: j.id };
  } catch (err) {
    console.error("Webex createWebexMeeting failed:", err);
    return null;
  }
}

/** Delete a Webex meeting on cancellation (best effort). */
export async function deleteWebexMeeting(hostId: number, meetingId: string) {
  const token = await getAccessToken(hostId);
  if (!token) return;
  try {
    await fetch(`${API}/meetings/${meetingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("Webex deleteWebexMeeting failed:", err);
  }
}
