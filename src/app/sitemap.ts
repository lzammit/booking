import type { MetadataRoute } from "next";
import db from "@/lib/db";

// Every public, indexable page: the landing, legal pages, each host's booking
// page with its active meeting types, and each team page with its types.
export default function sitemap(): MetadataRoute.Sitemap {
  const APP_URL = process.env.APP_URL || "http://localhost:3000";
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${APP_URL}/`, lastModified: now, priority: 1 },
    { url: `${APP_URL}/privacy`, lastModified: now, priority: 0.2 },
    { url: `${APP_URL}/terms`, lastModified: now, priority: 0.2 },
  ];

  const hosts = db.prepare("SELECT id, slug FROM hosts").all() as {
    id: number;
    slug: string;
  }[];
  for (const h of hosts) {
    entries.push({ url: `${APP_URL}/book/${h.slug}`, lastModified: now, priority: 0.8 });
    const ets = db
      .prepare(
        "SELECT slug FROM event_types WHERE host_id = ? AND active = 1 AND team_event_type_id IS NULL"
      )
      .all(h.id) as { slug: string }[];
    for (const et of ets) {
      entries.push({
        url: `${APP_URL}/book/${h.slug}/${et.slug}`,
        lastModified: now,
        priority: 0.6,
      });
    }
  }

  const teams = db.prepare("SELECT id, slug FROM teams").all() as {
    id: number;
    slug: string;
  }[];
  for (const t of teams) {
    entries.push({ url: `${APP_URL}/team/${t.slug}`, lastModified: now, priority: 0.9 });
    const tets = db
      .prepare("SELECT slug FROM team_event_types WHERE team_id = ? AND active = 1")
      .all(t.id) as { slug: string }[];
    for (const tet of tets) {
      entries.push({
        url: `${APP_URL}/team/${t.slug}/${tet.slug}`,
        lastModified: now,
        priority: 0.7,
      });
    }
  }
  return entries;
}
