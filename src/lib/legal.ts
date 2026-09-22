/**
 * Text of the three public legal pages (/legal, /privacy, /terms), in English
 * and French. Kept out of i18n.ts because these are documents, not UI strings.
 *
 * Values the code decides (retention months, cookie name and lifetime, busy
 * windows) come in through `LegalFacts`, so the pages describe the running
 * installation rather than a number typed here.
 *
 * Inline links use [text](href); LegalArticle renders them as anchors.
 */

import type { Locale } from "./i18n";

export const PUBLISHER_NAME = "Ludovic Zammit";
export const PUBLISHER_EMAIL = "booking@packetfence.net";
/** ISO date shown at the top of each page. Bump it when the text changes. */
export const LEGAL_UPDATED = "2026-09-22";

export type LegalFacts = {
  /** BOOKING_RETENTION_MONTHS as resolved by db.ts (0 = purge disabled). */
  retentionMonths: number;
  /** Session cookie name and lifetime from session.ts. */
  cookieName: string;
  cookieDays: number;
  /** Mac agent default push window (mac-agent/BookingAgent.swift, config.days). */
  agentWindowDays: number;
  /** Server-side calendar feed poll window (icsfeed.ts). */
  feedWindowDays: number;
};

export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  | { dl: [string, string][] };

export type LegalSection = { id: string; heading: string; blocks: LegalBlock[] };

export type LegalDoc = {
  /** Page title, also used for <title>. */
  title: string;
  /** Mono eyebrow above the title. */
  kind: string;
  updatedLabel: string;
  updated: string;
  intro: string;
  contentsLabel: string;
  sections: LegalSection[];
};

export type LegalDocs = { legal: LegalDoc; privacy: LegalDoc; terms: LegalDoc };

const mail = `[${PUBLISHER_EMAIL}](mailto:${PUBLISHER_EMAIL})`;

function en(f: LegalFacts): LegalDocs {
  const retention =
    f.retentionMonths > 0
      ? `Bookings are deleted ${f.retentionMonths} months after they end, together with the guest’s name, email and company.`
      : "Automatic deletion of old bookings is switched off on this installation; bookings stay until the host or the publisher deletes them.";
  return {
    legal: {
      title: "Legal notice",
      kind: "Legal notice",
      updatedLabel: "Last updated",
      updated: LEGAL_UPDATED,
      contentsLabel: "Contents",
      intro: "Who publishes this site, where it is hosted, and which rules apply to it.",
      sections: [
        {
          id: "publisher",
          heading: "Publisher",
          blocks: [
            {
              dl: [
                ["Publisher", PUBLISHER_NAME],
                [
                  "Status",
                  "Private individual, publishing this site on a non-professional basis. No company, no business registration number.",
                ],
                ["Based in", "Québec, Canada"],
                ["Director of publication", PUBLISHER_NAME],
                ["Contact", mail],
              ],
            },
            {
              p: "No postal address is published. Article 6-III-2 of the French law for confidence in the digital economy (LCEN) lets a non-professional publisher keep their address private as long as the hosting provider is identified. It is identified below.",
            },
          ],
        },
        {
          id: "hosting",
          heading: "Hosting",
          blocks: [
            {
              dl: [
                ["Provider", "Akamai Connected Cloud (Linode)"],
                ["Operated by", "Akamai Technologies, Inc."],
                ["Address", "145 Broadway, Cambridge, MA 02142, United States"],
                ["Server location", "Toronto, Canada"],
              ],
            },
            { p: "Data stored on the server stays in Canada." },
          ],
        },
        {
          id: "ip",
          heading: "Intellectual property",
          blocks: [
            {
              p: "The source code of this site is published under the MIT license; the LICENSE file ships with the code.",
            },
            {
              p: "What people type when they book (names, notes, answers to questions) belongs to them, not to the publisher.",
            },
          ],
        },
        {
          id: "law",
          heading: "Governing law",
          blocks: [
            {
              p: "This site is governed by the laws of Québec and of Canada. If you live in the European Union, you keep the mandatory consumer protections of your country of residence.",
            },
          ],
        },
        {
          id: "related",
          heading: "Related pages",
          blocks: [{ p: "[Privacy policy](/privacy) · [Terms of use](/terms)" }],
        },
      ],
    },
    privacy: {
      title: "Privacy policy",
      kind: "Privacy policy",
      updatedLabel: "Last updated",
      updated: LEGAL_UPDATED,
      contentsLabel: "Contents",
      intro:
        "Which personal data this site handles, why, for how long, and what you can do about it. It concerns two kinds of people: guests who book a meeting, and hosts who hold an account.",
      sections: [
        {
          id: "controller",
          heading: "Who is responsible",
          blocks: [
            {
              p: `The data controller is ${PUBLISHER_NAME}, a private individual based in Québec, Canada. Contact: ${mail}. Hosting details are in the [legal notice](/legal).`,
            },
          ],
        },
        {
          id: "laws",
          heading: "Which laws apply",
          blocks: [
            {
              p: "The site is operated from Québec. It follows the Personal Information Protection and Electronic Documents Act (PIPEDA) and Québec’s Act respecting the protection of personal information in the private sector, as amended by Law 25. If you are in the European Union or the United Kingdom, you also have the rights described below under the GDPR and the UK GDPR.",
            },
          ],
        },
        {
          id: "guests",
          heading: "If you book a meeting",
          blocks: [
            { p: "When you book a time with a host, the site stores:" },
            {
              ul: [
                "your name and email address;",
                "your company, if you fill it in (it is optional);",
                "your notes and your answers to the host’s questions;",
                "the timezone and language of your browser;",
                "the time you chose;",
                "a random token that makes your cancel and reschedule links work.",
              ],
            },
            {
              p: "This data is used to schedule the meeting and to send the confirmation, the calendar invitation, and any cancellation or reschedule notice, to you and to the host. The legal basis is the performance of the booking you asked for (a contract).",
            },
            {
              p: "The booking form is rate limited by IP address. The address is counted in the server’s memory only, for security (legitimate interest); it is never written to disk.",
            },
          ],
        },
        {
          id: "hosts",
          heading: "If you have a host account",
          blocks: [
            { p: "A host account stores:" },
            {
              ul: [
                "your name, email address and password, the password as a bcrypt hash and never in clear;",
                "your timezone, booking link name, weekly hours and days off;",
                "an API token for the Mac agent and a feed token for the calendar subscription;",
                "if you connected them, your Microsoft 365 or Webex OAuth tokens, encrypted at rest with AES-256-GCM;",
                "if you use the Mac agent or a calendar feed URL, the busy intervals from your calendar (start and end times only, no titles, attendees or locations), the feed URL, and the time of the last sync.",
              ],
            },
            {
              p: "The legal basis is the account you asked for (a contract) and legitimate interest for security.",
            },
          ],
        },
        {
          id: "recipients",
          heading: "Who receives the data",
          blocks: [
            { p: "The site runs on one server and passes data on only where the booking needs it:" },
            {
              ul: [
                "Email: confirmations, calendar invitations and notices go out over SMTP through Resend.",
                "Microsoft Graph (Microsoft 365) and Webex: only if the host connected these accounts, to create, update or delete the calendar event or the meeting.",
                "Slack: only if an administrator configured a team digest webhook. The digest lists the day’s team meetings with the guest’s name and company, never the email address or the notes.",
                "The host’s own Mac: the optional agent pulls the host’s bookings to write them into the local calendar.",
                "Hosting: Akamai Connected Cloud (Linode), Toronto, Canada.",
              ],
            },
            {
              p: "There is no analytics, no advertising and no third-party script. Fonts are served from this site.",
            },
          ],
        },
        {
          id: "cookies",
          heading: "Cookies",
          blocks: [
            {
              p: `The site sets exactly one cookie, ${f.cookieName}, and only when a host logs in. It holds the encrypted session (iron-session), is httpOnly and SameSite=Lax, and expires after ${f.cookieDays} days. Visitors who book a meeting get no cookie at all.`,
            },
            {
              p: "Because that cookie is strictly necessary to keep a host logged in, no consent banner is required, and none is shown.",
            },
          ],
        },
        {
          id: "retention",
          heading: "How long data is kept",
          blocks: [
            {
              ul: [
                "Notes and question answers are erased as soon as a booking is cancelled.",
                retention,
                "Host accounts are kept until the host or an administrator deletes them; deleting an account removes its bookings, busy intervals and tokens.",
                `Busy intervals cover a rolling window: about ${f.agentWindowDays} days ahead for the Mac agent, and from the previous day to ${f.feedWindowDays} days ahead for a calendar feed. Each sync replaces the previous set.`,
                "IP addresses used for rate limiting live in memory and disappear when the server restarts.",
              ],
            },
          ],
        },
        {
          id: "debrief",
          heading: "MeetingDebrief sync",
          blocks: [
            {
              p: `This server also hosts the sync endpoint of MeetingDebrief, a separate meeting notes application (/api/debrief/sync). The bundles that app uploads, meeting notes and transcripts in text form, are stored in one file on this server and can only be read back with that app’s token, for the person who uploaded them. The controller and the contact are the same as above; deletion requests go to ${mail}.`,
            },
          ],
        },
        {
          id: "rights",
          heading: "Your rights",
          blocks: [
            {
              p: `You can ask to access, correct or delete your data, receive a copy of it, object to its processing, or withdraw a consent you gave. Write to ${mail}. You can also complain to a supervisory authority:`,
            },
            {
              ul: [
                "Commission d’accès à l’information du Québec;",
                "Office of the Privacy Commissioner of Canada;",
                "for residents of France, the Commission nationale de l’informatique et des libertés (CNIL).",
              ],
            },
          ],
        },
        {
          id: "transfers",
          heading: "Where data is stored",
          blocks: [
            {
              p: "Data is stored in Canada, a country covered by an adequacy decision of the European Commission. Email transits through Resend, whose servers are in the United States.",
            },
          ],
        },
        {
          id: "children",
          heading: "Children",
          blocks: [{ p: "This service is not aimed at people under 16." }],
        },
        {
          id: "security",
          heading: "Security",
          blocks: [
            {
              p: "The site is served over HTTPS. Passwords are hashed with bcrypt, OAuth tokens are encrypted at rest, and access to the server is limited to the publisher.",
            },
          ],
        },
        {
          id: "changes",
          heading: "Changes",
          blocks: [
            {
              p: "The date at the top of this page shows when it was last updated. Check it again if you have not visited for a while.",
            },
          ],
        },
      ],
    },
    terms: {
      title: "Terms of use",
      kind: "Terms of use",
      updatedLabel: "Last updated",
      updated: LEGAL_UPDATED,
      contentsLabel: "Contents",
      intro:
        "Short rules for using this booking site. They apply to guests who book a meeting and to hosts who hold an account.",
      sections: [
        {
          id: "service",
          heading: "The service",
          blocks: [
            {
              p: "Booking lets a host publish a link where guests pick a meeting time; both sides receive a calendar invitation. The service is free and provided as is.",
            },
          ],
        },
        {
          id: "use",
          heading: "Acceptable use",
          blocks: [
            { p: "Do not:" },
            {
              ul: [
                "create bookings you do not intend to keep, or create them in bulk;",
                "scrape the site or query it automatically, outside the documented agent and feed endpoints;",
                "probe, overload or otherwise interfere with the service;",
                "use it to harass or spam anyone.",
              ],
            },
          ],
        },
        {
          id: "hosts",
          heading: "Hosts",
          blocks: [
            {
              p: "Hosts are responsible for the calendar data they connect or push, for keeping their password and tokens private, and for telling their guests how they will use the information collected through their booking page. Hosts may point guests to this site’s [privacy policy](/privacy).",
            },
          ],
        },
        {
          id: "suspension",
          heading: "Suspension",
          blocks: [
            {
              p: "The publisher may suspend or delete an account that breaks these rules or harms the service, and may cancel bookings made in abuse of it.",
            },
          ],
        },
        {
          id: "warranty",
          heading: "No warranty",
          blocks: [
            {
              p: "The service comes with no warranty of availability, accuracy or fitness for a purpose. It may be interrupted, changed or stopped. Keep your own copy of anything important.",
            },
          ],
        },
        {
          id: "liability",
          heading: "Liability",
          blocks: [
            {
              p: "To the extent permitted by law, the publisher is not liable for missed meetings, lost data or any indirect damage arising from the use of the service. Nothing here limits a liability that cannot be limited under the applicable law.",
            },
          ],
        },
        {
          id: "law",
          heading: "Governing law",
          blocks: [
            {
              p: "These terms are governed by the laws of Québec and of Canada. If you live in the European Union, you keep the mandatory consumer protections of your country of residence.",
            },
          ],
        },
        {
          id: "contact",
          heading: "Contact",
          blocks: [{ p: `Questions about these terms: ${mail}.` }],
        },
      ],
    },
  };
}

function fr(f: LegalFacts): LegalDocs {
  const retention =
    f.retentionMonths > 0
      ? `Les réservations sont supprimées ${f.retentionMonths} mois après la fin de la rencontre, avec le nom, le courriel et l’entreprise de l’invité.`
      : "La suppression automatique des anciennes réservations est désactivée sur cette installation ; elles restent jusqu’à ce que l’hôte ou l’éditeur les supprime.";
  return {
    legal: {
      title: "Mentions légales",
      kind: "Mentions légales",
      updatedLabel: "Dernière mise à jour",
      updated: LEGAL_UPDATED,
      contentsLabel: "Sommaire",
      intro: "Qui publie ce site, où il est hébergé et quelles règles s’y appliquent.",
      sections: [
        {
          id: "publisher",
          heading: "Éditeur",
          blocks: [
            {
              dl: [
                ["Éditeur", PUBLISHER_NAME],
                [
                  "Statut",
                  "Personne physique, publiant ce site à titre non professionnel. Pas de société, pas de numéro d’immatriculation.",
                ],
                ["Établi au", "Québec, Canada"],
                ["Directeur de la publication", PUBLISHER_NAME],
                ["Contact", mail],
              ],
            },
            {
              p: "Aucune adresse postale n’est publiée. L’article 6-III-2 de la loi française pour la confiance dans l’économie numérique (LCEN) permet à un éditeur non professionnel de ne pas divulguer son adresse dès lors que l’hébergeur est identifié. Il l’est ci-dessous.",
            },
          ],
        },
        {
          id: "hosting",
          heading: "Hébergement",
          blocks: [
            {
              dl: [
                ["Hébergeur", "Akamai Connected Cloud (Linode)"],
                ["Exploité par", "Akamai Technologies, Inc."],
                ["Adresse", "145 Broadway, Cambridge, MA 02142, États-Unis"],
                ["Emplacement du serveur", "Toronto, Canada"],
              ],
            },
            { p: "Les données stockées sur le serveur restent au Canada." },
          ],
        },
        {
          id: "ip",
          heading: "Propriété intellectuelle",
          blocks: [
            {
              p: "Le code source de ce site est publié sous licence MIT ; le fichier LICENSE accompagne le code.",
            },
            {
              p: "Ce que les personnes saisissent en réservant (noms, notes, réponses aux questions) leur appartient, pas à l’éditeur.",
            },
          ],
        },
        {
          id: "law",
          heading: "Droit applicable",
          blocks: [
            {
              p: "Ce site est régi par les lois du Québec et du Canada. Si vous résidez dans l’Union européenne, vous conservez les protections impératives du droit de la consommation de votre pays de résidence.",
            },
          ],
        },
        {
          id: "related",
          heading: "Pages liées",
          blocks: [
            { p: "[Politique de confidentialité](/privacy) · [Conditions d’utilisation](/terms)" },
          ],
        },
      ],
    },
    privacy: {
      title: "Politique de confidentialité",
      kind: "Politique de confidentialité",
      updatedLabel: "Dernière mise à jour",
      updated: LEGAL_UPDATED,
      contentsLabel: "Sommaire",
      intro:
        "Quelles données personnelles ce site traite, pourquoi, pendant combien de temps, et ce que vous pouvez faire à leur sujet. Elle concerne deux types de personnes : les invités qui réservent une rencontre et les hôtes qui détiennent un compte.",
      sections: [
        {
          id: "controller",
          heading: "Qui est responsable",
          blocks: [
            {
              p: `Le responsable du traitement est ${PUBLISHER_NAME}, personne physique établie au Québec, Canada. Contact : ${mail}. Les informations d’hébergement figurent dans les [mentions légales](/legal).`,
            },
          ],
        },
        {
          id: "laws",
          heading: "Lois applicables",
          blocks: [
            {
              p: "Le site est exploité depuis le Québec. Il respecte la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE) et la Loi sur la protection des renseignements personnels dans le secteur privé du Québec, telle que modifiée par la Loi 25. Si vous êtes dans l’Union européenne ou au Royaume-Uni, vous disposez aussi des droits décrits plus bas au titre du RGPD et du UK GDPR.",
            },
          ],
        },
        {
          id: "guests",
          heading: "Si vous réservez une rencontre",
          blocks: [
            { p: "Lorsque vous réservez un créneau avec un hôte, le site enregistre :" },
            {
              ul: [
                "votre nom et votre adresse courriel ;",
                "votre entreprise, si vous la renseignez (elle est facultative) ;",
                "vos notes et vos réponses aux questions de l’hôte ;",
                "le fuseau horaire et la langue de votre navigateur ;",
                "l’heure choisie ;",
                "un jeton aléatoire qui fait fonctionner vos liens d’annulation et de déplacement.",
              ],
            },
            {
              p: "Ces données servent à planifier la rencontre et à envoyer la confirmation, l’invitation d’agenda et tout avis d’annulation ou de déplacement, à vous et à l’hôte. La base juridique est l’exécution de la réservation que vous avez demandée (un contrat).",
            },
            {
              p: "Le formulaire de réservation est limité en fréquence par adresse IP. L’adresse est comptée uniquement dans la mémoire du serveur, à des fins de sécurité (intérêt légitime) ; elle n’est jamais écrite sur disque.",
            },
          ],
        },
        {
          id: "hosts",
          heading: "Si vous détenez un compte d’hôte",
          blocks: [
            { p: "Un compte d’hôte enregistre :" },
            {
              ul: [
                "votre nom, votre adresse courriel et votre mot de passe, ce dernier sous forme de hachage bcrypt et jamais en clair ;",
                "votre fuseau horaire, le nom de votre lien de réservation, vos heures hebdomadaires et vos jours de congé ;",
                "un jeton d’API pour l’agent Mac et un jeton de flux pour l’abonnement d’agenda ;",
                "si vous les avez connectés, vos jetons OAuth Microsoft 365 ou Webex, chiffrés au repos avec AES-256-GCM ;",
                "si vous utilisez l’agent Mac ou l’URL d’un flux d’agenda, les plages occupées de votre agenda (heures de début et de fin seulement, sans titre, participant ni lieu), l’URL du flux et l’heure de la dernière synchronisation.",
              ],
            },
            {
              p: "La base juridique est le compte que vous avez demandé (un contrat) et l’intérêt légitime pour la sécurité.",
            },
          ],
        },
        {
          id: "recipients",
          heading: "Qui reçoit les données",
          blocks: [
            {
              p: "Le site tourne sur un seul serveur et ne transmet des données que là où la réservation l’exige :",
            },
            {
              ul: [
                "Courriel : les confirmations, invitations d’agenda et avis partent en SMTP par Resend.",
                "Microsoft Graph (Microsoft 365) et Webex : seulement si l’hôte a connecté ces comptes, pour créer, modifier ou supprimer l’événement d’agenda ou la réunion.",
                "Slack : seulement si un administrateur a configuré un webhook de résumé d’équipe. Le résumé liste les rencontres d’équipe du jour avec le nom et l’entreprise de l’invité, jamais son courriel ni ses notes.",
                "Le Mac de l’hôte : l’agent facultatif récupère les réservations de l’hôte pour les inscrire dans son agenda local.",
                "Hébergement : Akamai Connected Cloud (Linode), Toronto, Canada.",
              ],
            },
            {
              p: "Il n’y a ni mesure d’audience, ni publicité, ni script tiers. Les polices sont servies depuis ce site.",
            },
          ],
        },
        {
          id: "cookies",
          heading: "Témoins (cookies)",
          blocks: [
            {
              p: `Le site dépose exactement un témoin, ${f.cookieName}, et seulement lorsqu’un hôte se connecte. Il contient la session chiffrée (iron-session), est httpOnly et SameSite=Lax, et expire après ${f.cookieDays} jours. Les visiteurs qui réservent une rencontre ne reçoivent aucun témoin.`,
            },
            {
              p: "Ce témoin étant strictement nécessaire pour garder un hôte connecté, aucune bannière de consentement n’est requise, et aucune n’est affichée.",
            },
          ],
        },
        {
          id: "retention",
          heading: "Durée de conservation",
          blocks: [
            {
              ul: [
                "Les notes et les réponses aux questions sont effacées dès qu’une réservation est annulée.",
                retention,
                "Les comptes d’hôte sont conservés jusqu’à ce que l’hôte ou un administrateur les supprime ; la suppression d’un compte retire ses réservations, ses plages occupées et ses jetons.",
                `Les plages occupées couvrent une fenêtre glissante : environ ${f.agentWindowDays} jours à venir pour l’agent Mac, et de la veille à ${f.feedWindowDays} jours à venir pour un flux d’agenda. Chaque synchronisation remplace la précédente.`,
                "Les adresses IP utilisées pour la limitation de fréquence restent en mémoire et disparaissent au redémarrage du serveur.",
              ],
            },
          ],
        },
        {
          id: "debrief",
          heading: "Synchronisation MeetingDebrief",
          blocks: [
            {
              p: `Ce serveur héberge aussi le point de synchronisation de MeetingDebrief, une application distincte de comptes rendus de réunion (/api/debrief/sync). Les paquets que cette application téléverse, des notes et des transcriptions de réunion sous forme de texte, sont stockés dans un seul fichier sur ce serveur et ne peuvent être relus qu’avec le jeton de cette application, pour la personne qui les a téléversés. Le responsable et le contact sont les mêmes que ci-dessus ; les demandes de suppression s’adressent à ${mail}.`,
            },
          ],
        },
        {
          id: "rights",
          heading: "Vos droits",
          blocks: [
            {
              p: `Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement, en recevoir une copie, vous opposer à leur traitement ou retirer un consentement donné. Écrivez à ${mail}. Vous pouvez aussi porter plainte auprès d’une autorité de contrôle :`,
            },
            {
              ul: [
                "la Commission d’accès à l’information du Québec ;",
                "le Commissariat à la protection de la vie privée du Canada ;",
                "pour les résidents français, la Commission nationale de l’informatique et des libertés (CNIL).",
              ],
            },
          ],
        },
        {
          id: "transfers",
          heading: "Où sont stockées les données",
          blocks: [
            {
              p: "Les données sont stockées au Canada, pays couvert par une décision d’adéquation de la Commission européenne. Le courriel transite par Resend, dont les serveurs sont aux États-Unis.",
            },
          ],
        },
        {
          id: "children",
          heading: "Mineurs",
          blocks: [{ p: "Ce service ne s’adresse pas aux personnes de moins de 16 ans." }],
        },
        {
          id: "security",
          heading: "Sécurité",
          blocks: [
            {
              p: "Le site est servi en HTTPS. Les mots de passe sont hachés avec bcrypt, les jetons OAuth sont chiffrés au repos et l’accès au serveur est limité à l’éditeur.",
            },
          ],
        },
        {
          id: "changes",
          heading: "Modifications",
          blocks: [
            {
              p: "La date en haut de cette page indique sa dernière mise à jour. Revenez la consulter si votre dernière visite date un peu.",
            },
          ],
        },
      ],
    },
    terms: {
      title: "Conditions d’utilisation",
      kind: "Conditions d’utilisation",
      updatedLabel: "Dernière mise à jour",
      updated: LEGAL_UPDATED,
      contentsLabel: "Sommaire",
      intro:
        "Quelques règles pour utiliser ce site de réservation. Elles s’appliquent aux invités qui réservent une rencontre et aux hôtes qui détiennent un compte.",
      sections: [
        {
          id: "service",
          heading: "Le service",
          blocks: [
            {
              p: "Booking permet à un hôte de publier un lien où les invités choisissent une heure de rencontre ; les deux parties reçoivent une invitation d’agenda. Le service est gratuit et fourni tel quel.",
            },
          ],
        },
        {
          id: "use",
          heading: "Usage acceptable",
          blocks: [
            { p: "Il est interdit de :" },
            {
              ul: [
                "créer des réservations que vous n’avez pas l’intention d’honorer, ou en créer en masse ;",
                "aspirer le site ou l’interroger automatiquement, hors des points d’accès documentés de l’agent et du flux ;",
                "sonder, surcharger ou perturber le service de quelque façon ;",
                "l’utiliser pour harceler ou importuner qui que ce soit.",
              ],
            },
          ],
        },
        {
          id: "hosts",
          heading: "Hôtes",
          blocks: [
            {
              p: "Les hôtes sont responsables des données d’agenda qu’ils connectent ou transmettent, de la confidentialité de leur mot de passe et de leurs jetons, et de l’information donnée à leurs invités sur l’usage des renseignements recueillis par leur page de réservation. Ils peuvent renvoyer leurs invités à la [politique de confidentialité](/privacy) de ce site.",
            },
          ],
        },
        {
          id: "suspension",
          heading: "Suspension",
          blocks: [
            {
              p: "L’éditeur peut suspendre ou supprimer un compte qui enfreint ces règles ou nuit au service, et annuler les réservations faites de façon abusive.",
            },
          ],
        },
        {
          id: "warranty",
          heading: "Absence de garantie",
          blocks: [
            {
              p: "Le service est fourni sans garantie de disponibilité, d’exactitude ni d’adéquation à un usage. Il peut être interrompu, modifié ou arrêté. Gardez votre propre copie de ce qui compte.",
            },
          ],
        },
        {
          id: "liability",
          heading: "Responsabilité",
          blocks: [
            {
              p: "Dans la mesure permise par la loi, l’éditeur n’est pas responsable des rencontres manquées, des données perdues ni de tout dommage indirect découlant de l’usage du service. Rien ici ne limite une responsabilité qui ne peut l’être selon le droit applicable.",
            },
          ],
        },
        {
          id: "law",
          heading: "Droit applicable",
          blocks: [
            {
              p: "Ces conditions sont régies par les lois du Québec et du Canada. Si vous résidez dans l’Union européenne, vous conservez les protections impératives du droit de la consommation de votre pays de résidence.",
            },
          ],
        },
        {
          id: "contact",
          heading: "Contact",
          blocks: [{ p: `Questions sur ces conditions : ${mail}.` }],
        },
      ],
    },
  };
}

const builders: Record<Locale, (f: LegalFacts) => LegalDocs> = { en, fr };

export function legalDocs(locale: Locale, facts: LegalFacts): LegalDocs {
  return (builders[locale] ?? en)(facts);
}
