"use client";

/**
 * Opens an OAuth authorize flow in a popup (which routes through the org's SSO
 * automatically). The provider's callback page closes the popup and redirects
 * this tab; a poll on the closed popup reloads as a fallback. Falls back to a
 * full-page redirect if the popup is blocked.
 */
export default function PopupConnectButton({
  path,
  label = "Connect",
}: {
  path: string;
  label?: string;
}) {
  function connect() {
    const w = 600;
    const h = 760;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(path, "oauth-connect", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      window.location.href = path;
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
      {label}
    </button>
  );
}
