/**
 * The values quoted on /privacy that the running code decides. Kept apart
 * from legal.ts so the text module stays free of database and session imports.
 */

import { bookingRetentionMonths } from "./db";
import { FEED_WINDOW_DAYS } from "./icsfeed";
import type { LegalFacts } from "./legal";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from "./session";

/** Default push window of the Mac agent (mac-agent/BookingAgent.swift, `config.days ?? 60`). */
export const AGENT_WINDOW_DAYS = 60;

export function legalFacts(): LegalFacts {
  return {
    retentionMonths: bookingRetentionMonths(),
    cookieName: SESSION_COOKIE_NAME,
    cookieDays: SESSION_TTL_DAYS,
    agentWindowDays: AGENT_WINDOW_DAYS,
    feedWindowDays: FEED_WINDOW_DAYS,
  };
}
