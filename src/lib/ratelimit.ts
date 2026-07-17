/**
 * Small in-memory sliding-window rate limiter. Per-process (fine for a
 * single-instance deployment); survives until restart. Keys are typically
 * "<action>:<client-ip>".
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 20_000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    // Emergency purge: drop entries whose newest hit is stale.
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Client IP as seen behind the reverse proxy (Caddy sets X-Forwarded-For). */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Collapse whitespace and strip control characters from user-entered text
 * (defends ICS/SMTP header injection at the source). */
export function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
