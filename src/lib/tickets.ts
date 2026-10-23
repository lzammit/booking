/**
 * Support-ticket gate for team booking pages (MantisBT at help.inverse.ca).
 *
 * A ticket number is always format-checked. When MANTIS_API_TOKEN is set in
 * the server .env, it is also looked up through Mantis' REST API
 * (GET /api/rest/issues/<id>), so a made-up number is refused. Mantis being
 * down or slow never blocks a client: an unreachable tracker falls back to
 * the format check, and the host sees "unverified" on the booking.
 */

export const DEFAULT_TICKET_HELP_URL = "https://help.inverse.ca/";

export type TicketCheck =
  | { ok: true; id: string; verified: boolean; status?: string; summary?: string }
  | { ok: false; code: "ticket_invalid" | "ticket_not_found" };

/** "#12345", " 0012345 " → "12345". Mantis ids are positive integers. */
export function normalizeTicket(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/^#/, "").replace(/\s+/g, "");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = s.replace(/^0+/, "");
  return n ? n : null;
}

/** Mantis shows ids zero-padded to 7 digits; match that so clients recognise it. */
export const displayTicket = (id: string) => id.padStart(7, "0");

function baseUrl(helpUrl: string): string {
  const u = (helpUrl || DEFAULT_TICKET_HELP_URL).trim();
  return u.endsWith("/") ? u : u + "/";
}

/** The staff-facing link to the ticket (Mantis requires a login to view). */
export const ticketUrl = (id: string, helpUrl: string) => `${baseUrl(helpUrl)}view.php?id=${id}`;

const cache = new Map<string, { at: number; result: TicketCheck }>();
const CACHE_MS = 10 * 60 * 1000;

export async function checkTicket(raw: string, helpUrl: string): Promise<TicketCheck> {
  const id = normalizeTicket(raw);
  if (!id) return { ok: false, code: "ticket_invalid" };

  const token = process.env.MANTIS_API_TOKEN;
  if (!token) return { ok: true, id, verified: false };

  const key = `${baseUrl(helpUrl)}#${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  let result: TicketCheck;
  try {
    const res = await fetch(`${baseUrl(helpUrl)}api/rest/issues/${id}`, {
      headers: { Authorization: token, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (res.status === 404) {
      result = { ok: false, code: "ticket_not_found" };
    } else if (res.ok) {
      const data = (await res.json()) as {
        issues?: { status?: { name?: string }; summary?: string }[];
      };
      const issue = data.issues?.[0];
      result = issue
        ? { ok: true, id, verified: true, status: issue.status?.name, summary: issue.summary }
        : { ok: false, code: "ticket_not_found" };
    } else {
      // 401/403/5xx: our token or the tracker is the problem, not the client.
      console.error(`Mantis lookup for #${id} returned ${res.status}`);
      return { ok: true, id, verified: false };
    }
  } catch (err) {
    console.error(`Mantis lookup for #${id} failed:`, err);
    return { ok: true, id, verified: false };
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

/** The line folded into the booking notes (and so into invites, emails, agent events). */
export function ticketNoteLine(check: Extract<TicketCheck, { ok: true }>, helpUrl: string): string {
  const bits = [`Ticket #${displayTicket(check.id)}`];
  if (check.status) bits.push(`(${check.status})`);
  if (!check.verified && process.env.MANTIS_API_TOKEN) bits.push("(not verified: tracker unreachable)");
  if (check.summary) bits.push(`"${check.summary.slice(0, 120)}"`);
  return `${bits.join(" ")} ${ticketUrl(check.id, helpUrl)}`;
}
