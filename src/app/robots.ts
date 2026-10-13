import type { MetadataRoute } from "next";

// One rule for every crawler — search engines and AI bots (GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, …) alike: public booking pages are welcome,
// anything private, token-bearing, or machine-to-machine is not.
export default function robots(): MetadataRoute.Robots {
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/api/",
          "/cancel/",
          "/reschedule/",
          "/reset/",
          "/forgot",
          "/login",
          "/signup",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
