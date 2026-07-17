"use client";

/**
 * Opens the Webex OAuth authorize page in a popup (which routes through the
 * org's SSO automatically). The callback page closes the popup and redirects
 * this tab; a poll on the closed popup refreshes as a fallback.
 */
export default function WebexConnectButton() {
  function connect() {
    const w = 600;
    const h = 760;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      "/api/webex/connect",
      "webex-auth",
      `width=${w},height=${h},left=${left},top=${top}`
    );
    if (!popup) {
      // Popup blocked — fall back to a full-page redirect.
      window.location.href = "/api/webex/connect";
      return;
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        window.location.reload();
      }
    }, 800);
  }

  return (
    <button
      onClick={connect}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
    >
      Connect
    </button>
  );
}
