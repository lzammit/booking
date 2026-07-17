"use server";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import db, {
  adminCode,
  adminCodeEnabled,
  Booking,
  EventType,
  Host,
  setSetting,
  signupCode,
} from "./db";
import { getSession, requireAdmin, requireHost } from "./session";
import { sendAdminPromotionEmail, sendBookingEmails, sendInviteEmail } from "./email";
import { clearIcsFeedData, refreshIcsFeed } from "./icsfeed";
import { deleteOutlookEvent, msDisconnect } from "./msgraph";
import { deleteWebexMeeting, webexDisconnect } from "./webex";

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

  // The admin onboarding code grants admin and always suffices on its own;
  // otherwise the regular signup code is enforced when one is set.
  const adminOnboard = adminCode();
  const requiredCode = signupCode();
  const isAdminSignup =
    adminCodeEnabled() && Boolean(adminOnboard) && invite === adminOnboard;
  if (!isAdminSignup && requiredCode && invite !== requiredCode) {
    redirect("/signup?error=Invalid+invite+code");
  }

  // Prefer a personal slug: full name, then the email local part, then numbers.
  const slugTaken = db.prepare("SELECT 1 FROM hosts WHERE slug = ?");
  let slug = slugify(name) || "host";
  if (slugTaken.get(slug)) {
    const fromEmail = slugify(email.split("@")[0]);
    if (fromEmail && !slugTaken.get(fromEmail)) {
      slug = fromEmail;
    } else {
      const base = slug;
      let n = 2;
      while (slugTaken.get(slug)) slug = `${base}-${n++}`;
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  let hostId: number;
  try {
    const res = db
      .prepare(
        "INSERT INTO hosts (email, name, slug, password_hash, timezone, api_token, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        email.toLowerCase(),
        name,
        slug,
        hash,
        timezone,
        randomBytes(24).toString("hex"),
        isAdminSignup ? 1 : 0
      );
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

/** Subscribe to a calendar feed (ICS URL) — server-side poll. */
export async function subscribeIcsFeed(formData: FormData) {
  const host = await requireHost();
  // Apple/iCloud hand out webcal:// links — same thing over HTTPS.
  const url = String(formData.get("icsUrl") || "")
    .trim()
    .replace(/^webcal:\/\//i, "https://");
  if (!/^https:\/\/\S+$/.test(url) || url.length > 500) {
    redirect("/dashboard/settings?error=" + encodeURIComponent("Enter a valid https:// or webcal:// ICS link"));
  }
  let blocks: number | null = null;
  try {
    blocks = await refreshIcsFeed(host.id, url);
  } catch (err) {
    console.error(`ICS subscribe failed for host ${host.id}:`, err);
  }
  if (blocks === null) {
    redirect(
      "/dashboard/settings?error=" +
        encodeURIComponent("Couldn't read that link as an ICS calendar — check the URL")
    );
  }
  db.prepare("UPDATE hosts SET ics_url = ? WHERE id = ?").run(url, host.id);
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}

export async function unsubscribeIcsFeed() {
  const host = await requireHost();
  db.prepare("UPDATE hosts SET ics_url = NULL WHERE id = ?").run(host.id);
  clearIcsFeedData(host.id);
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}

export async function updateSlug(formData: FormData) {
  const host = await requireHost();
  const slug = String(formData.get("slug") || "").toLowerCase().trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    redirect(
      "/dashboard?error=" +
        encodeURIComponent("Link must be 2-40 chars: letters, numbers, dashes")
    );
  }
  const taken = db
    .prepare("SELECT 1 FROM hosts WHERE slug = ? AND id != ?")
    .get(slug, host.id);
  if (taken) {
    redirect("/dashboard?error=" + encodeURIComponent(`"${slug}" is already taken`));
  }
  db.prepare("UPDATE hosts SET slug = ? WHERE id = ?").run(slug, host.id);
  redirect("/dashboard?saved=1");
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
  meeting_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\//.test(v), "Must be a URL")
    .default(""),
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
    `INSERT INTO event_types (host_id, name, slug, description, duration_min, buffer_min, min_notice_min, window_days, meeting_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(host.id, d.name, slug, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url);
  redirect("/dashboard/event-types");
}

export async function updateEventType(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  const parsed = eventTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/dashboard/event-types?error=Invalid+form+data");
  const d = parsed.data;
  // Note: active is NOT touched here — it's a separate, explicit toggle so
  // editing fields can never silently hide an event from the booking page.
  db.prepare(
    `UPDATE event_types SET name=?, description=?, duration_min=?, buffer_min=?, min_notice_min=?, window_days=?, meeting_url=?
     WHERE id = ? AND host_id = ?`
  ).run(d.name, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url, id, host.id);
  redirect("/dashboard/event-types");
}

export async function deleteEventType(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  db.prepare("DELETE FROM event_types WHERE id = ? AND host_id = ?").run(id, host.id);
  redirect("/dashboard/event-types");
}

export async function toggleEventTypeActive(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  db.prepare(
    "UPDATE event_types SET active = 1 - active WHERE id = ? AND host_id = ?"
  ).run(id, host.id);
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
    if (booking.webex_meeting_id) await deleteWebexMeeting(host.id, booking.webex_meeting_id);
    await sendBookingEmails({ ...booking, status: "cancelled" }, host, eventType, "cancelled");
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function disconnectWebex() {
  const host = await requireHost();
  webexDisconnect(host.id);
  redirect("/dashboard/settings?webex=disconnected");
}

export async function adminConfigureWebex(formData: FormData) {
  await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();
  if (!clientId || !clientSecret) {
    // Empty values clear the integration.
    setSetting("webex_client_id", "");
    setSetting("webex_client_secret", "");
    redirect("/dashboard/settings?webex=cleared");
  }
  setSetting("webex_client_id", clientId);
  setSetting("webex_client_secret", clientSecret);
  redirect("/dashboard/settings?webex=configured");
}

export async function adminConfigureMicrosoft(formData: FormData) {
  await requireAdmin();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();
  const tenantId = String(formData.get("tenant_id") ?? "").trim() || "common";
  if (!clientId || !clientSecret) {
    setSetting("ms_client_id", "");
    setSetting("ms_client_secret", "");
    setSetting("ms_tenant_id", "");
    redirect("/dashboard/settings?ms=cleared");
  }
  setSetting("ms_client_id", clientId);
  setSetting("ms_client_secret", clientSecret);
  setSetting("ms_tenant_id", tenantId);
  redirect("/dashboard/settings?ms=configured");
}

export async function disconnectMicrosoft() {
  const host = await requireHost();
  msDisconnect(host.id);
  redirect("/dashboard/settings?ms=disconnected");
}

// ----- Admin actions -----

export async function adminToggleAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (id === admin.id) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("You can't demote yourself"));
  }
  db.prepare("UPDATE hosts SET is_admin = 1 - is_admin WHERE id = ?").run(id);
  const target = db.prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Host | undefined;
  if (target?.is_admin) {
    await sendAdminPromotionEmail(target.email, target.name, admin.name);
  }
  redirect("/dashboard/admin?saved=1");
}

export async function adminDeleteHost(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (id === admin.id) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("You can't delete yourself"));
  }
  // Foreign keys cascade: event types, availability, bookings, tokens, busy data.
  db.prepare("DELETE FROM hosts WHERE id = ?").run(id);
  redirect("/dashboard/admin?saved=1");
}

export async function adminSetAdminCode(formData: FormData) {
  await requireAdmin();
  const code = String(formData.get("code") ?? "").trim();
  if (code && !/^[\x20-\x7E]{6,60}$/.test(code)) {
    redirect(
      "/dashboard/admin?error=" +
        encodeURIComponent("Admin code must be 6-60 plain characters (or empty to clear)")
    );
  }
  setSetting("admin_code", code);
  redirect("/dashboard/admin?saved=1");
}

export async function adminToggleAdminCode() {
  await requireAdmin();
  setSetting("admin_code_enabled", adminCodeEnabled() ? "0" : "1");
  redirect("/dashboard/admin?saved=1");
}

export async function adminInviteUser(formData: FormData) {
  const admin = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!z.string().email().max(200).safeParse(email).success) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Enter a valid email address"));
  }
  if (db.prepare("SELECT 1 FROM hosts WHERE email = ?").get(email)) {
    redirect("/dashboard/admin?error=" + encodeURIComponent(`${email} already has an account`));
  }
  const params = new URLSearchParams({ email });
  const code = signupCode();
  if (code) params.set("invite", code);
  const url = `${process.env.APP_URL}/signup?${params}`;
  const sent = await sendInviteEmail(email, admin.name, url);
  if (!sent) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Sending failed — check SMTP settings"));
  }
  redirect("/dashboard/admin?invited=" + encodeURIComponent(email));
}

export async function adminSetSignupCode(formData: FormData) {
  await requireAdmin();
  const code = String(formData.get("code") ?? "").trim();
  if (code && !/^[\x20-\x7E]{4,60}$/.test(code)) {
    redirect(
      "/dashboard/admin?error=" +
        encodeURIComponent("Code must be 4-60 plain characters (or empty to open signup)")
    );
  }
  setSetting("signup_code", code);
  redirect("/dashboard/admin?saved=1");
}

export async function adminResetPassword(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const password = String(formData.get("password") || "");
  if (password.length < 8) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Password must be 8+ characters"));
  }
  db.prepare("UPDATE hosts SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(password, 10),
    id
  );
  redirect("/dashboard/admin?saved=1");
}
