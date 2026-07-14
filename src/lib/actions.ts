"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import db, { Booking, EventType, Host } from "./db";
import { getSession, requireHost } from "./session";
import { sendBookingEmails } from "./email";
import { deleteOutlookEvent, msDisconnect } from "./msgraph";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const signupSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  timezone: z.string().min(1).max(60),
  invite: z.string().optional(),
});

export async function signup(formData: FormData) {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/signup?error=Invalid+form+data");
  const { name, email, password, timezone, invite } = parsed.data;

  if (process.env.SIGNUP_CODE && invite !== process.env.SIGNUP_CODE) {
    redirect("/signup?error=Invalid+invite+code");
  }

  let slug = slugify(name) || "host";
  const slugTaken = db.prepare("SELECT 1 FROM hosts WHERE slug = ?");
  let n = 2;
  const base = slug;
  while (slugTaken.get(slug)) slug = `${base}-${n++}`;

  const hash = bcrypt.hashSync(password, 10);
  let hostId: number;
  try {
    const res = db
      .prepare(
        "INSERT INTO hosts (email, name, slug, password_hash, timezone) VALUES (?, ?, ?, ?, ?)"
      )
      .run(email.toLowerCase(), name, slug, hash, timezone);
    hostId = Number(res.lastInsertRowid);
  } catch {
    redirect("/signup?error=Email+already+registered");
  }

  // Default availability: Mon-Fri 9:00-17:00, and a default 30-min event type.
  const insRule = db.prepare(
    "INSERT INTO availability_rules (host_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)"
  );
  for (let wd = 1; wd <= 5; wd++) insRule.run(hostId, wd, 9 * 60, 17 * 60);
  db.prepare(
    "INSERT INTO event_types (host_id, name, slug, duration_min) VALUES (?, '30 minute meeting', '30min', 30)"
  ).run(hostId);

  const session = await getSession();
  session.hostId = hostId;
  await session.save();
  redirect("/dashboard");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") || "").toLowerCase();
  const password = String(formData.get("password") || "");
  const host = db
    .prepare("SELECT * FROM hosts WHERE email = ?")
    .get(email) as Host | undefined;
  if (!host || !bcrypt.compareSync(password, host.password_hash)) {
    redirect("/login?error=Invalid+email+or+password");
  }
  const session = await getSession();
  session.hostId = host.id;
  await session.save();
  redirect("/dashboard");
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

const rulesSchema = z.array(
  z.object({
    weekday: z.number().int().min(1).max(7),
    start_min: z.number().int().min(0).max(1439),
    end_min: z.number().int().min(1).max(1440),
  })
);

export async function saveAvailability(formData: FormData) {
  const host = await requireHost();
  let rules;
  try {
    rules = rulesSchema.parse(JSON.parse(String(formData.get("rules"))));
  } catch {
    redirect("/dashboard/availability?error=Invalid+rules");
  }
  const bad = rules.find((r) => r.end_min <= r.start_min);
  if (bad) redirect("/dashboard/availability?error=End+must+be+after+start");

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM availability_rules WHERE host_id = ?").run(host.id);
    const ins = db.prepare(
      "INSERT INTO availability_rules (host_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)"
    );
    for (const r of rules) ins.run(host.id, r.weekday, r.start_min, r.end_min);
  });
  tx();
  redirect("/dashboard/availability?saved=1");
}

export async function updateTimezone(formData: FormData) {
  const host = await requireHost();
  const tz = String(formData.get("timezone") || "");
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    redirect("/dashboard/availability?error=Invalid+timezone");
  }
  db.prepare("UPDATE hosts SET timezone = ? WHERE id = ?").run(tz, host.id);
  redirect("/dashboard/availability?saved=1");
}

const eventTypeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(""),
  duration_min: z.coerce.number().int().min(5).max(480),
  buffer_min: z.coerce.number().int().min(0).max(120).default(0),
  min_notice_min: z.coerce.number().int().min(0).max(10080).default(120),
  window_days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function createEventType(formData: FormData) {
  const host = await requireHost();
  const parsed = eventTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/event-types?error=Invalid+form+data");
  const d = parsed.data;
  let slug = slugify(d.name) || "meeting";
  const taken = db.prepare(
    "SELECT 1 FROM event_types WHERE host_id = ? AND slug = ?"
  );
  let n = 2;
  const base = slug;
  while (taken.get(host.id, slug)) slug = `${base}-${n++}`;
  db.prepare(
    `INSERT INTO event_types (host_id, name, slug, description, duration_min, buffer_min, min_notice_min, window_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(host.id, d.name, slug, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days);
  redirect("/dashboard/event-types");
}

export async function updateEventType(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  const parsed = eventTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/event-types?error=Invalid+form+data");
  const d = parsed.data;
  const active = formData.get("active") === "on" ? 1 : 0;
  db.prepare(
    `UPDATE event_types SET name=?, description=?, duration_min=?, buffer_min=?, min_notice_min=?, window_days=?, active=?
     WHERE id = ? AND host_id = ?`
  ).run(d.name, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, active, id, host.id);
  redirect("/dashboard/event-types");
}

export async function deleteEventType(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  db.prepare("DELETE FROM event_types WHERE id = ? AND host_id = ?").run(id, host.id);
  redirect("/dashboard/event-types");
}

export async function cancelBookingAsHost(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  const booking = db
    .prepare("SELECT * FROM bookings WHERE id = ? AND host_id = ? AND status = 'confirmed'")
    .get(id, host.id) as Booking | undefined;
  if (booking) {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
    const eventType = db
      .prepare("SELECT * FROM event_types WHERE id = ?")
      .get(booking.event_type_id) as EventType;
    if (booking.ms_event_id) await deleteOutlookEvent(host.id, booking.ms_event_id);
    await sendBookingEmails({ ...booking, status: "cancelled" }, host, eventType, "cancelled");
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function disconnectMicrosoft() {
  const host = await requireHost();
  msDisconnect(host.id);
  redirect("/dashboard?ms=disconnected");
}
