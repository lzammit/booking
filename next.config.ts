import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    // Public booking pages may be embedded (support portals, signatures);
    // everything else — dashboard, login, admin — stays frame-locked against
    // clickjacking. frame-ancestors takes precedence over X-Frame-Options in
    // every modern browser, so the pair below opens exactly the public pages.
    const embeddable = ["/book/:path*", "/team/:path*"].map((source) => ({
      source,
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors *" },
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
