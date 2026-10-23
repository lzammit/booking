import { NextRequest, NextResponse } from "next/server";
import db, { Team } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { checkTicket, displayTicket } from "@/lib/tickets";

/**
 * Gate step of a ticket-gated team page: is this ticket number acceptable?
 * Answers only ok / invalid / not found (never the ticket's content), and is
 * throttled per IP so it can't be used to probe the tracker.
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(`ticket:${clientIp(req.headers)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }
  const sp = req.nextUrl.searchParams;
  const tetId = Number(sp.get("teamEventTypeId"));
  const team = db
    .prepare(
      "SELECT t.* FROM teams t JOIN team_event_types e ON e.team_id = t.id WHERE e.id = ? AND e.active = 1"
    )
    .get(tetId) as Team | undefined;
  if (!team) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });

  const check = await checkTicket(sp.get("ticket") ?? "", team.ticket_help_url);
  if (!check.ok) return NextResponse.json({ ok: false, code: check.code });
  return NextResponse.json({ ok: true, ticket: displayTicket(check.id) });
}
