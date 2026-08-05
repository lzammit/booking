"use server";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { headers } from "next/headers";
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
import {
  sendAdminPromotionEmail,
  sendBookingEmails,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "./email";
import { clearIcsFeedData, refreshIcsFeed } from "./icsfeed";
import { deleteOutlookEvent, msDisconnect } from "./msgraph";
import { createWebexMeeting, deleteWebexMeeting, webexDisconnect } from "./webex";
import { cleanText, clientIp, rateLimit } from "./ratelimit";
import { shadowEventTypeFor } from "./teams";
import { isSlotFree } from "./slots";
import type { TeamEventType } from "./db";

/** Constant-time string comparison (via digests, so lengths may differ). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}

async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

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
  name: z.string().min(1).max(80).transform(cleanText).refine((s) => s.length > 0),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  timezone: z.string().min(1).max(60),
  invite: z.string().optional(),
});

export async function signup(formData: FormData) {
  // Throttle account creation and invite-code guessing.
  if (!rateLimit(`signup:${await requestIp()}`, 5, 60 * 60 * 1000)) {
    redirect("/signup?error=" + encodeURIComponent("Too many attempts — try again later"));
  }

  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/signup?error=Invalid+form+data");
  const { name, email, password, timezone, invite } = parsed.data;

  // The admin onboarding code grants admin and always suffices on its own;
  // otherwise the regular signup code is enforced when one is set.
  const adminOnboard = adminCode();
  const requiredCode = signupCode();
  const isAdminSignup =
    adminCodeEnabled() &&
    Boolean(adminOnboard) &&
    Boolean(invite) &&
    safeEqual(invite!, adminOnboard);
  if (!isAdminSignup && requiredCode && !safeEqual(invite ?? "", requiredCode)) {
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
  // Throttle brute force: per IP, and per target account across IPs.
  const ip = await requestIp();
  if (
    !rateLimit(`login:${ip}`, 10, 15 * 60 * 1000) ||
    !rateLimit(`login-email:${email}`, 20, 15 * 60 * 1000)
  ) {
    redirect("/login?error=" + encodeURIComponent("Too many attempts — try again later"));
  }
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

const RESET_TTL_MS = 60 * 60 * 1000; // reset links are valid for one hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Start a password reset. Always redirects to the same "sent" page regardless
 * of whether the email exists, so the form can't be used to enumerate accounts.
 */
export async function requestPasswordReset(formData: FormData) {
  const ip = await requestIp();
  const email = String(formData.get("email") || "").toLowerCase().trim();
  // Throttle both per IP and per targeted account.
  if (
    !rateLimit(`reset:${ip}`, 5, 60 * 60 * 1000) ||
    !rateLimit(`reset-email:${email}`, 5, 60 * 60 * 1000)
  ) {
    redirect("/forgot?sent=1");
  }
  if (z.string().email().max(200).safeParse(email).success) {
    const host = db.prepare("SELECT * FROM hosts WHERE email = ?").get(email) as
      | Host
      | undefined;
    if (host) {
      // One live link at a time: drop any earlier unused tokens for this host.
      db.prepare("DELETE FROM password_resets WHERE host_id = ?").run(host.id);
      const token = randomBytes(32).toString("hex");
      db.prepare(
        "INSERT INTO password_resets (token_hash, host_id, expires_at) VALUES (?, ?, ?)"
      ).run(hashToken(token), host.id, Date.now() + RESET_TTL_MS);
      await sendPasswordResetEmail(
        host.email,
        host.name,
        `${process.env.APP_URL}/reset/${token}`
      );
    }
  }
  redirect("/forgot?sent=1");
}

/** Look up a live (unused, unexpired) reset token; returns the host id or null. */
export async function resetTokenHostId(token: string): Promise<number | null> {
  const row = db
    .prepare(
      "SELECT host_id, expires_at, used_at FROM password_resets WHERE token_hash = ?"
    )
    .get(hashToken(token)) as
    | { host_id: number; expires_at: number; used_at: number | null }
    | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return row.host_id;
}

/** Consume a reset token and set a new password. */
export async function resetPassword(formData: FormData) {
  if (!rateLimit(`reset-submit:${await requestIp()}`, 10, 60 * 60 * 1000)) {
    redirect("/login?error=" + encodeURIComponent("Too many attempts — try again later"));
  }
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const hostId = await resetTokenHostId(token);
  if (!hostId) {
    redirect("/reset/" + encodeURIComponent(token) + "?error=invalid");
  }
  if (password.length < 8 || password.length > 200) {
    redirect("/reset/" + encodeURIComponent(token) + "?error=short");
  }
  const tx = db.transaction(() => {
    db.prepare("UPDATE hosts SET password_hash = ? WHERE id = ?").run(
      bcrypt.hashSync(password, 10),
      hostId
    );
    // Invalidate every reset token for the account once one is consumed.
    db.prepare("DELETE FROM password_resets WHERE host_id = ?").run(hostId);
  });
  tx();
  redirect("/login?reset=1");
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
  if (slug === host.slug) redirect("/dashboard?saved=1");
  const taken = db
    .prepare("SELECT 1 FROM hosts WHERE slug = ? AND id != ?")
    .get(slug, host.id);
  if (taken) {
    redirect("/dashboard?error=" + encodeURIComponent(`"${slug}" is already taken`));
  }
  const oldSlug = host.slug;
  const tx = db.transaction(() => {
    // The new slug becomes a real slug, so drop any parked alias by that name.
    db.prepare("DELETE FROM slug_aliases WHERE slug = ?").run(slug);
    db.prepare("UPDATE hosts SET slug = ? WHERE id = ?").run(slug, host.id);
    // Park the old slug so links people already have keep resolving here.
    db.prepare(
      "INSERT OR REPLACE INTO slug_aliases (slug, host_id) VALUES (?, ?)"
    ).run(oldSlug, host.id);
  });
  tx();
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
  // One booking question per line; shown on the public form.
  questions: z
    .string()
    .max(2000)
    .default("")
    .transform((s) =>
      s
        .split("\n")
        .map((q) => cleanText(q))
        .filter(Boolean)
        .slice(0, 10)
        .join("\n")
    ),
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
    `INSERT INTO event_types (host_id, name, slug, description, duration_min, buffer_min, min_notice_min, window_days, meeting_url, questions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(host.id, d.name, slug, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url, d.questions);
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
    `UPDATE event_types SET name=?, description=?, duration_min=?, buffer_min=?, min_notice_min=?, window_days=?, meeting_url=?, questions=?
     WHERE id = ? AND host_id = ?`
  ).run(d.name, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url, d.questions, id, host.id);
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

/**
 * Hand a team booking off to another member of the same team. The booking
 * keeps its id (so the iCalendar UID is stable); a bumped SEQUENCE plus a
 * fresh invite from the new host makes the guest's calendar update in place.
 * Old and new hosts' agents/feeds reconcile on their next sync.
 */
export async function reassignTeamBooking(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("target_id"));
  const fail = (msg: string) => redirect("/dashboard?error=" + encodeURIComponent(msg));

  const booking = db
    .prepare(
      "SELECT * FROM bookings WHERE id = ? AND host_id = ? AND status = 'confirmed' AND team_id IS NOT NULL AND end_utc > ?"
    )
    .get(id, host.id, new Date().toISOString()) as Booking | undefined;
  if (!booking) fail("Booking not found or not reassignable");

  const isMember = db
    .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND host_id = ?")
    .get(booking!.team_id, targetId);
  const target = db.prepare("SELECT * FROM hosts WHERE id = ?").get(targetId) as
    | Host
    | undefined;
  if (!isMember || !target || target.id === host.id) fail("Pick another team member");

  // The team event type, reached through the booking's shadow copy.
  const currentEt = db
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .get(booking!.event_type_id) as EventType;
  const tet = db
    .prepare("SELECT * FROM team_event_types WHERE id = ?")
    .get(currentEt.team_event_type_id) as TeamEventType | undefined;
  if (!tet) fail("The team meeting type no longer exists");

  const shadow = shadowEventTypeFor(target!, tet!);
  // Availability check only — a hand-off must work on short notice and beyond
  // the public booking window, so those two constraints are lifted.
  const checkEt = { ...shadow, min_notice_min: 0, window_days: 365 };
  if (!(await isSlotFree(target!, checkEt, booking!.start_utc))) {
    fail(`${target!.name} is not free at that time`);
  }

  db.prepare(
    "UPDATE bookings SET host_id = ?, event_type_id = ?, sequence = sequence + 1 WHERE id = ?"
  ).run(target!.id, shadow.id, booking!.id);

  // Meeting-link bookkeeping, all best-effort. A dynamic Webex meeting hangs
  // off the old host's account, so it's recreated under the new host.
  if (booking!.webex_meeting_id) {
    await deleteWebexMeeting(host.id, booking!.webex_meeting_id);
    const webex = await createWebexMeeting({
      hostId: target!.id,
      title: `${tet!.name} — ${target!.name} / ${booking!.guest_name}`,
      agenda: `${booking!.notes ? booking!.notes + "\n\n" : ""}Guest: ${booking!.guest_name} (${booking!.guest_company}) <${booking!.guest_email}>`,
      startUtc: booking!.start_utc,
      endUtc: booking!.end_utc,
      guestEmail: booking!.guest_email,
    });
    db.prepare("UPDATE bookings SET webex_link = ?, webex_meeting_id = ? WHERE id = ?").run(
      webex?.link ?? tet!.meeting_url ?? null,
      webex?.meetingId ?? null,
      booking!.id
    );
  }
  if (booking!.ms_event_id) {
    await deleteOutlookEvent(host.id, booking!.ms_event_id);
    db.prepare("UPDATE bookings SET ms_event_id = NULL WHERE id = ?").run(booking!.id);
  }

  const fresh = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking!.id) as Booking;
  await sendBookingEmails(fresh, target!, shadow, "confirmed");

  revalidatePath("/dashboard");
  redirect("/dashboard?saved=1");
}

export async function deletePastBooking(formData: FormData) {
  const host = await requireHost();
  const id = Number(formData.get("id"));
  // Only history can be removed: cancelled bookings, or ones already over.
  // Upcoming confirmed meetings must go through Cancel (which notifies the
  // guest and cleans up meetings/invites) — never silent deletion.
  db.prepare(
    `DELETE FROM bookings
     WHERE id = ? AND host_id = ?
       AND (status = 'cancelled' OR end_utc <= ?)`
  ).run(id, host.id, new Date().toISOString());
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

// ----- Teams (admin-managed groups with a shared round-robin booking URL) -----

export async function adminCreateTeam(formData: FormData) {
  await requireAdmin();
  const name = cleanText(String(formData.get("name") || "")).slice(0, 80);
  if (!name) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Team name is required"));
  }
  const taken = db.prepare("SELECT 1 FROM teams WHERE slug = ?");
  let slug = slugify(name) || "team";
  const base = slug;
  let n = 2;
  while (taken.get(slug)) slug = `${base}-${n++}`;
  const res = db.prepare("INSERT INTO teams (name, slug) VALUES (?, ?)").run(name, slug);
  // Start with a sensible default meeting type so the page works right away.
  db.prepare(
    "INSERT INTO team_event_types (team_id, name, slug, duration_min) VALUES (?, '30 minute meeting', '30min', 30)"
  ).run(Number(res.lastInsertRowid));
  redirect("/dashboard/admin?saved=1");
}

export async function adminDeleteTeam(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  // Members' past bookings survive: they live on the member (host_id) with a
  // shadow event type row; only the team, its URL, and its meeting types go.
  db.prepare("DELETE FROM teams WHERE id = ?").run(id);
  redirect("/dashboard/admin?saved=1");
}

export async function adminToggleTeamLiveSync(formData: FormData) {
  await requireAdmin();
  db.prepare("UPDATE teams SET require_live_sync = 1 - require_live_sync WHERE id = ?").run(
    Number(formData.get("id"))
  );
  redirect("/dashboard/admin?saved=1");
}

export async function adminAddTeamMember(formData: FormData) {
  await requireAdmin();
  const teamId = Number(formData.get("team_id"));
  const hostId = Number(formData.get("host_id"));
  if (!db.prepare("SELECT 1 FROM hosts WHERE id = ?").get(hostId)) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Pick a user to add"));
  }
  db.prepare(
    "INSERT OR IGNORE INTO team_members (team_id, host_id) VALUES (?, ?)"
  ).run(teamId, hostId);
  redirect("/dashboard/admin?saved=1");
}

export async function adminRemoveTeamMember(formData: FormData) {
  await requireAdmin();
  db.prepare("DELETE FROM team_members WHERE team_id = ? AND host_id = ?").run(
    Number(formData.get("team_id")),
    Number(formData.get("host_id"))
  );
  redirect("/dashboard/admin?saved=1");
}

export async function adminCreateTeamEventType(formData: FormData) {
  await requireAdmin();
  const teamId = Number(formData.get("team_id"));
  const parsed = eventTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Invalid meeting type data"));
  }
  const d = parsed.data;
  let slug = slugify(d.name) || "meeting";
  const taken = db.prepare("SELECT 1 FROM team_event_types WHERE team_id = ? AND slug = ?");
  const base = slug;
  let n = 2;
  while (taken.get(teamId, slug)) slug = `${base}-${n++}`;
  db.prepare(
    `INSERT INTO team_event_types (team_id, name, slug, description, duration_min, buffer_min, min_notice_min, window_days, meeting_url, questions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(teamId, d.name, slug, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url, d.questions);
  redirect("/dashboard/admin?saved=1");
}

export async function adminUpdateTeamEventType(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const parsed = eventTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect("/dashboard/admin?error=" + encodeURIComponent("Invalid meeting type data"));
  }
  const d = parsed.data;
  db.prepare(
    `UPDATE team_event_types SET name=?, description=?, duration_min=?, buffer_min=?, min_notice_min=?, window_days=?, meeting_url=?, questions=?
     WHERE id = ?`
  ).run(d.name, d.description, d.duration_min, d.buffer_min, d.min_notice_min, d.window_days, d.meeting_url, d.questions, id);
  // Members' shadow copies re-sync on the next booking (shadowEventTypeFor).
  redirect("/dashboard/admin?saved=1");
}

export async function adminToggleTeamEventType(formData: FormData) {
  await requireAdmin();
  db.prepare("UPDATE team_event_types SET active = 1 - active WHERE id = ?").run(
    Number(formData.get("id"))
  );
  redirect("/dashboard/admin?saved=1");
}

export async function adminDeleteTeamEventType(formData: FormData) {
  await requireAdmin();
  db.prepare("DELETE FROM team_event_types WHERE id = ?").run(Number(formData.get("id")));
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
