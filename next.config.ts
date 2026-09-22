import type { NextConfig } from "next";

/**
 * Sites allowed to embed the public booking pages in an iframe, from
 * EMBED_ALLOWED_ORIGINS (space-separated origins, e.g.
 * "https://support.example.com https://intranet.example.net"). Unset or empty
 * means same-origin only, so nobody can frame the booking form by default.
 */
function frameAncestors(): string {
  const origins = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
    .split(/\s+/)
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^\s;,'"]+$/.test(o));
  return ["'self'", ...origins].join(" ");
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    // Public booking pages may be embedded by the origins listed in
    // EMBED_ALLOWED_ORIGINS (support portals, intranets); everything else,
    // dashboard, login, admin, stays frame-locked against clickjacking.
    // frame-ancestors takes precedence over X-Frame-Options in every modern
    // browser, so the pair below opens exactly the public pages.
    const embeddable = ["/book/:path*", "/team/:path*"].map((source) => ({
      source,
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors()}` },
      ],
    }));
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      ...embeddable,
    ];
  },
};

export default nextConfig;
