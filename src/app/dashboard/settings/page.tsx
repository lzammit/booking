import { DateTime } from "luxon";
import db from "@/lib/db";
import { requireHost } from "@/lib/session";
import {
  adminConfigureMicrosoft,
  adminConfigureWebex,
  disconnectMicrosoft,
  disconnectWebex,
  subscribeIcsFeed,
  unsubscribeIcsFeed,
} from "@/lib/actions";
import { msAccountFor, msConfigured, msRedirectUri, MS_SCOPES } from "@/lib/msgraph";
import { webexAccountFor, webexConfigured, webexRedirectUri, WEBEX_SCOPES } from "@/lib/webex";
import PopupConnectButton from "../PopupConnectButton";
import SignatureCard from "../SignatureCard";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const host = await requireHost();
  const msAccount = msAccountFor(host.id);
  const webexAccount = webexAccountFor(host.id);
  const agentSync = db
    .prepare("SELECT source, blocks, last_sync FROM agent_syncs WHERE host_id = ?")
    .all(host.id) as { source: string; blocks: number; last_sync: string }[];
  // Agent pushes every 5 minutes; >15 min silence means it's offline.
  const allSyncs = agentSync.map((s) => {
    const last = DateTime.fromSQL(s.last_sync, { zone: "utc" });
    return {
      ...s,
      connected: DateTime.utc().diff(last, "minutes").minutes < 15,
      lastLabel: last.setZone(host.timezone).toFormat("LLL d, h:mm a"),
      agoLabel: last.toRelative() ?? "",
    };
  });
  // The server-side ICS feed poll shows in its own card, not as an agent.
  const feedSources = ["ics-feed", "outlook-feed"];
  const icsFeed = allSyncs.find((s) => feedSources.includes(s.source)) ?? null;
  const agents = allSyncs.filter((s) => !feedSources.includes(s.source));

  return (
    <main className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {error && (
        <p className="rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold">Email signature</h2>
        <p className="text-sm text-gray-500 mb-3">
          Add this to your email signature so people can book you in one click.
        </p>
        <SignatureCard bookingUrl={`${process.env.APP_URL}/book/${host.slug}`} />
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Webex meetings</h2>
            <p className="text-sm text-gray-500">
              {webexConfigured()
                ? webexAccount
                  ? `${webexAccount === "connected" ? "Connected" : `Connected as ${webexAccount}`}. Each booking creates a Webex meeting; the join link goes in both invites.`
                  : "Connect your Webex account so every booking gets its own Webex meeting link. Sign in with your usual Akamai SSO in the popup."
                : host.is_admin
                  ? "Not set up yet. Configure the Webex integration once, then each host connects their own account."
                  : "Not set up yet — ask an admin to configure the Webex integration."}
            </p>
          </div>
          {webexConfigured() &&
            (webexAccount ? (
              <form action={disconnectWebex}>
                <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                  Disconnect
                </button>
              </form>
            ) : (
              <PopupConnectButton path="/api/webex/connect" />
            ))}
        </div>

        {!webexConfigured() && host.is_admin === 1 && (
          <details className="mt-3 border-t border-gray-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-blue-600">
              Configure Webex integration
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
              <li>
                Open{" "}
                <a
                  href="https://developer.webex.com/my-apps/new/integration"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  developer.webex.com → Create an Integration
                </a>
                .
              </li>
              <li>
                Redirect URI:{" "}
                <code className="break-all rounded bg-gray-50 px-1">{webexRedirectUri()}</code>
              </li>
              <li>
                Scopes:{" "}
                <code className="break-all rounded bg-gray-50 px-1">{WEBEX_SCOPES}</code>
              </li>
              <li>Paste the generated Client ID and Secret below.</li>
            </ol>
            <form action={adminConfigureWebex} className="mt-3 space-y-2">
              <input
                name="client_id"
                required
                placeholder="Client ID"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
              />
              <input
                name="client_secret"
                required
                type="password"
                placeholder="Client Secret"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
              />
              <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                Save integration
              </button>
            </form>
          </details>
        )}

        {webexConfigured() && host.is_admin === 1 && (
          <form action={adminConfigureWebex} className="mt-3 border-t border-gray-100 pt-3">
            <input type="hidden" name="client_id" value="" />
            <input type="hidden" name="client_secret" value="" />
            <button className="text-xs text-gray-400 hover:text-red-600">
              Remove Webex integration
            </button>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Microsoft 365 calendar</h2>
            <p className="text-sm text-gray-500">
              {msConfigured()
                ? msAccount
                  ? `${msAccount === "connected" ? "Connected" : `Connected as ${msAccount}`}. Busy times are blocked; bookings appear in Outlook.`
                  : "Connect to block your busy times and create Outlook events on booking. Sign in with your usual Akamai SSO in the popup."
                : host.is_admin
                  ? "Not set up yet. Configure the Microsoft 365 app once, then each host connects their own account."
                  : "Not set up yet — ask an admin to configure the Microsoft 365 integration."}
            </p>
          </div>
          {msConfigured() &&
            (msAccount ? (
              <form action={disconnectMicrosoft}>
                <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                  Disconnect
                </button>
              </form>
            ) : (
              <PopupConnectButton path="/api/ms/connect" />
            ))}
        </div>

        {!msConfigured() && host.is_admin === 1 && (
          <details className="mt-3 border-t border-gray-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-blue-600">
              Configure Microsoft 365 integration
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
              <li>
                Open{" "}
                <a
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Azure Portal → App registrations → New registration
                </a>
                .
              </li>
              <li>
                Redirect URI (type <em>Web</em>):{" "}
                <code className="break-all rounded bg-gray-50 px-1">{msRedirectUri()}</code>
              </li>
              <li>
                Add a client secret, and delegated Graph permissions:{" "}
                <code className="break-all rounded bg-gray-50 px-1">{MS_SCOPES}</code>
              </li>
              <li>Paste the Application (client) ID, secret, and tenant ID below.</li>
            </ol>
            <form action={adminConfigureMicrosoft} className="mt-3 space-y-2">
              <input
                name="client_id"
                required
                placeholder="Application (client) ID"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
              />
              <input
                name="client_secret"
                required
                type="password"
                placeholder="Client secret value"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
              />
              <input
                name="tenant_id"
                placeholder="Tenant ID (or leave blank for 'common')"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm"
              />
              <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                Save integration
              </button>
            </form>
          </details>
        )}

        {msConfigured() && host.is_admin === 1 && (
          <form action={adminConfigureMicrosoft} className="mt-3 border-t border-gray-100 pt-3">
            <input type="hidden" name="client_id" value="" />
            <input type="hidden" name="client_secret" value="" />
            <button className="text-xs text-gray-400 hover:text-red-600">
              Remove Microsoft 365 integration
            </button>
          </form>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-medium">Calendar feed (ICS)</h3>
          {host.ics_url ? (
            <div className="mt-1 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-500 break-all">
                Subscribed — this calendar&apos;s busy times sync automatically
                {icsFeed ? ` (${icsFeed.blocks} busy blocks, updated ${icsFeed.agoLabel})` : ""}.
                <span className="block text-xs text-gray-400 mt-0.5">{host.ics_url}</span>
              </p>
              <form action={unsubscribeIcsFeed}>
                <button className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                  Unsubscribe
                </button>
              </form>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-500">
                Paste any calendar&apos;s ICS link and its busy times sync automatically — no
                install, no admin consent. <span className="text-gray-600">Google Calendar</span>:
                Settings → your calendar → Integrate calendar → “Secret address in iCal format”.{" "}
                <span className="text-gray-600">Outlook</span>: Settings → Calendar → Shared
                calendars → “Publish a calendar” (some organizations disable this).{" "}
                <span className="text-gray-600">iCloud</span>: public calendar link (webcal:// is
                fine).
              </p>
              <form action={subscribeIcsFeed} className="mt-2 flex gap-2">
                <input
                  name="icsUrl"
                  placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                  Subscribe
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-medium">Your bookings as a calendar</h3>
          <p className="mt-1 text-sm text-gray-500">
            Subscribe to this feed in your calendar app and your bookings show up there —
            cancellations disappear automatically. <span className="text-gray-600">Outlook</span>:
            Add calendar → Subscribe from web. <span className="text-gray-600">Apple Calendar</span>:
            File → New Calendar Subscription. <span className="text-gray-600">Google</span>: Other
            calendars → From URL. Note: calendar apps refresh subscriptions on their own schedule
            (Outlook can take a few hours).
          </p>
          <code className="block mt-2 text-xs bg-gray-50 border border-gray-200 rounded-md p-2 break-all select-all">
            {`${process.env.APP_URL}/api/feed/${host.feed_token}.ics`}
          </code>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Local calendar agent</h2>
          {agents.length > 0 &&
            (agents.some((a) => a.connected) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-700">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Offline
              </span>
            ))}
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-gray-500">
            No agent has synced yet. Install the Mac agent and use the API token below.
          </p>
        ) : (
          <ul className="text-sm text-gray-600 mt-1">
            {agents.map((a) => (
              <li key={a.source}>
                <span className="font-mono">{a.source}</span>: {a.blocks} busy blocks · last
                check-in {a.agoLabel} ({a.lastLabel})
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-3">
          <a
            href="/api/agent/download"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Download Mac agent
          </a>
          <div className="text-xs text-gray-400 space-y-1">
            <p>
              Pre-configured with your token. Unzip and open BookingAgent; when macOS blocks
              it, click Done, then System Settings → Privacy &amp; Security → “Open Anyway”
              (first launch only), and allow Calendar access.
            </p>
            <p>
              If “Open Anyway” is blocked (managed Macs), run this in Terminal, then open the
              app again:{" "}
              <code className="font-mono bg-gray-50 border border-gray-200 rounded px-1">
                xattr -dr com.apple.quarantine ~/Downloads/BookingAgent*/BookingAgent.app
              </code>
            </p>
          </div>
        </div>
        <details className="mt-2">
          <summary className="text-sm text-blue-600 cursor-pointer">Show API token</summary>
          <code className="block mt-1 text-xs bg-gray-50 border border-gray-200 rounded-md p-2 break-all">
            {host.api_token}
          </code>
        </details>
      </section>
    </main>
  );
}
