import db from "@/lib/db";

/**
 * llms.txt — the emerging convention for telling AI crawlers and assistants
 * what a site is and where its useful pages live, in plain markdown.
 * Generated from the live database so booking links are always current.
 */
export async function GET() {
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const hosts = db.prepare("SELECT name, slug FROM hosts ORDER BY name").all() as {
    name: string;
    slug: string;
  }[];
  const teams = db.prepare("SELECT name, slug FROM teams ORDER BY name").all() as {
    name: string;
    slug: string;
  }[];

  const lines = [
    "# Booking — PacketFence meeting scheduling",
    "",
    "> Self-hosted scheduling app for the PacketFence support team at Akamai.",
    "> Visitors pick a meeting type, then a time slot that fits the host's real",
    "> calendar; the booking is confirmed by email with a calendar invite and a",
    "> join link. No visitor account is needed.",
    "",
    "## Team booking pages (round-robin: any available member takes the meeting)",
    "",
    ...teams.map((t) => `- [Book with ${t.name}](${APP_URL}/team/${t.slug})`),
    "",
    "## Individual booking pages",
    "",
    ...hosts.map((h) => `- [Book time with ${h.name}](${APP_URL}/book/${h.slug})`),
    "",
    "## Legal",
    "",
    `- [Privacy policy](${APP_URL}/privacy)`,
    `- [Terms](${APP_URL}/terms)`,
    "",
    "Availability is computed live; the pages above always show current open",
    "slots. Dashboard and API routes are private and excluded from crawling.",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
