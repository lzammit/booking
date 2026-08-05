/**
 * Slack via incoming webhook — the admin pastes a webhook URL (Slack app →
 * Incoming Webhooks) and the app POSTs mrkdwn messages to that channel.
 * No OAuth, no token storage.
 */

export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function postSlackMessage(webhook: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error("Slack webhook failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Slack webhook failed:", err);
    return false;
  }
}
