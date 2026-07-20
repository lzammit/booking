/**
 * Lightweight i18n for the guest-facing surface. The locale is detected from
 * the browser's Accept-Language header (server) or passed down as a prop
 * (client components). Adding a language = adding a dictionary here.
 *
 * The host dashboard/admin intentionally stays English for now.
 */

export type Locale = "en" | "fr";
export const LOCALES: Locale[] = ["en", "fr"];

/** Best supported locale for an Accept-Language header value. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (code === "fr") return "fr";
    if (code === "en") return "en";
  }
  return "en";
}

const en = {
  // Host landing page
  bookTimeWith: "Book time with",
  pickMeetingIntro:
    "Pick a meeting, then a time that suits you. Times are shown in your own timezone.",
  nothingOpen: "Nothing is open for booking right now.",
  min: "min",
  // Event booking page
  allMeetingTypes: "All meeting types",
  // Widget
  weekdaysShort: "Mo,Tu,We,Th,Fr,Sa,Su",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  loadingAvailability: "Loading availability…",
  timesShownIn: "Times shown in",
  reset: "reset",
  backToYourTz: "Back to your timezone ({tz})",
  morning: "morning",
  midday: "midday",
  evening: "evening",
  chooseDay: "Choose an outlined day to see its times.",
  greyTime: "Grey time = {host}’s ({zone})",
  forHost: "= {time} for {host}",
  yourName: "Your name",
  company: "Company",
  yourEmail: "Your email",
  notesPlaceholder: "Anything to share ahead of the meeting? (optional)",
  confirmBooking: "Confirm booking",
  bookingEllipsis: "Booking…",
  back: "Back",
  errLoad: "Availability didn’t load. Try again in a moment.",
  errGeneric: "Booking failed",
  slot_taken: "That time is no longer available. Please pick another slot.",
  rate_limited: "Too many booking attempts — please try again in a few minutes.",
  booked: "You’re booked.",
  bookedLine:
    "{min} minutes with {host}, shown in {tz}. A confirmation email with a calendar invite is on its way.",
  // Cancel page
  cancelTitle: "Cancel this booking?",
  cancelledTitle: "Booking cancelled",
  withHost: "{event} with {host}",
  cancelButton: "Cancel this booking",
  cancelledInfo:
    "This time is freed up. If you need a new one, book again from the original link.",
  // 404
  nf_eyebrow: "404 · unscheduled",
  nf_title: "This time doesn’t exist",
  nf_text:
    "You’ve landed in a gap on the calendar — no host, no meeting, just open space between dawn and dusk. Nobody’s free here, because there’s no “here” to be free in.",
  nf_noSlots: "no slots found",
  nf_cta: "Find a time that does →",
  // Landing
  landing_eyebrow: "Meeting scheduling",
  landing_tagline:
    "Share one link. People pick a time that fits both calendars — morning, midday, or evening.",
  openDashboard: "Open dashboard",
  logIn: "Log in",
  signUp: "Sign up",
  // Login / signup
  login_title: "Log in",
  email: "Email",
  password: "Password",
  noAccount: "No account?",
  signup_title: "Create your account",
  fullName: "Full name",
  passwordHint: "Password (8+ characters)",
  inviteCode: "Invite code",
  haveAccount: "Already have an account?",
  tzHint: "Timezone: {tz} (change later in Availability)",
  // Guest emails
  mail_confirmedSubject: "Confirmed: {what} — {when}",
  mail_cancelledSubject: "Cancelled: {what}",
  mail_hi: "Hi {name},",
  mail_confirmedBody: "Your booking is confirmed.",
  mail_cancelledBody: "This booking has been cancelled.",
  mail_what: "What: {what} ({min} min)",
  mail_whatPlain: "What: {what}",
  mail_when: "When: {when}",
  mail_join: "Join Webex: {link}",
  mail_cancelLink: "Need to cancel? {url}",
} as const;

export type MessageKey = keyof typeof en;

const fr: Record<MessageKey, string> = {
  bookTimeWith: "Réserver du temps avec",
  pickMeetingIntro:
    "Choisissez un type de rencontre, puis une heure qui vous convient. Les heures sont affichées dans votre fuseau horaire.",
  nothingOpen: "Aucune réservation n’est ouverte pour le moment.",
  min: "min",
  allMeetingTypes: "Tous les types de rencontre",
  weekdaysShort: "Lu,Ma,Me,Je,Ve,Sa,Di",
  prevMonth: "Mois précédent",
  nextMonth: "Mois suivant",
  loadingAvailability: "Chargement des disponibilités…",
  timesShownIn: "Heures affichées dans",
  reset: "défaut",
  backToYourTz: "Revenir à votre fuseau ({tz})",
  morning: "matin",
  midday: "midi",
  evening: "soir",
  chooseDay: "Choisissez un jour entouré pour voir ses heures.",
  greyTime: "Heure grise = celle de {host} ({zone})",
  forHost: "= {time} pour {host}",
  yourName: "Votre nom",
  company: "Entreprise",
  yourEmail: "Votre courriel",
  notesPlaceholder: "Quelque chose à partager avant la rencontre ? (facultatif)",
  confirmBooking: "Confirmer la réservation",
  bookingEllipsis: "Réservation…",
  back: "Retour",
  errLoad: "Les disponibilités n’ont pas pu être chargées. Réessayez dans un instant.",
  errGeneric: "Échec de la réservation",
  slot_taken: "Ce créneau n’est plus disponible. Choisissez-en un autre.",
  rate_limited: "Trop de tentatives — réessayez dans quelques minutes.",
  booked: "C’est réservé.",
  bookedLine:
    "{min} minutes avec {host}, heure affichée dans {tz}. Un courriel de confirmation avec une invitation d’agenda est en route.",
  cancelTitle: "Annuler cette réservation ?",
  cancelledTitle: "Réservation annulée",
  withHost: "{event} avec {host}",
  cancelButton: "Annuler cette réservation",
  cancelledInfo:
    "Ce créneau est libéré. S’il vous faut une nouvelle heure, repassez par le lien d’origine.",
  nf_eyebrow: "404 · non planifié",
  nf_title: "Cette heure n’existe pas",
  nf_text:
    "Vous êtes tombé dans un trou de l’agenda — pas d’hôte, pas de rencontre, juste de l’espace libre entre l’aube et le crépuscule. Personne n’est disponible ici, car il n’y a pas d’« ici ».",
  nf_noSlots: "aucun créneau trouvé",
  nf_cta: "Trouver une heure qui existe →",
  landing_eyebrow: "Planification de rencontres",
  landing_tagline:
    "Partagez un seul lien. Chacun choisit une heure qui convient aux deux agendas — matin, midi ou soir.",
  openDashboard: "Ouvrir le tableau de bord",
  logIn: "Se connecter",
  signUp: "Créer un compte",
  login_title: "Connexion",
  email: "Courriel",
  password: "Mot de passe",
  noAccount: "Pas de compte ?",
  signup_title: "Créez votre compte",
  fullName: "Nom complet",
  passwordHint: "Mot de passe (8 caractères ou plus)",
  inviteCode: "Code d’invitation",
  haveAccount: "Déjà un compte ?",
  tzHint: "Fuseau horaire : {tz} (modifiable plus tard)",
  mail_confirmedSubject: "Confirmé : {what} — {when}",
  mail_cancelledSubject: "Annulé : {what}",
  mail_hi: "Bonjour {name},",
  mail_confirmedBody: "Votre réservation est confirmée.",
  mail_cancelledBody: "Cette réservation a été annulée.",
  mail_what: "Quoi : {what} ({min} min)",
  mail_whatPlain: "Quoi : {what}",
  mail_when: "Quand : {when}",
  mail_join: "Rejoindre Webex : {link}",
  mail_cancelLink: "Besoin d’annuler ? {url}",
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, fr };

export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  let msg = dictionaries[locale][key] ?? en[key];
  for (const [k, v] of Object.entries(vars ?? {})) {
    msg = msg.replaceAll(`{${k}}`, String(v));
  }
  return msg;
}
