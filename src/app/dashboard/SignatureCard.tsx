"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Email-signature snippet with the host's booking link. Email-client-safe:
 * table layout, inline styles, no external assets. "Copy signature" puts
 * rich HTML on the clipboard for pasting straight into Outlook / Apple Mail
 * signature editors; "Copy HTML" gives the raw source.
 */
export default function SignatureCard({ bookingUrl }: { bookingUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const html = useMemo(
    () =>
      `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif;">
  <tr>
    <td style="padding: 2px 0 8px 0;">
      <a href="${bookingUrl}" target="_blank" style="display: inline-block; background-color: #1C2333; color: #FBFAF7; text-decoration: none; font-size: 14px; font-weight: bold; padding: 10px 18px; border-radius: 8px;">&#128197;&nbsp; Book time with me</a>
    </td>
  </tr>
  <tr>
    <td>
      <table cellpadding="0" cellspacing="0" border="0" width="150">
        <tr>
          <td width="50" height="3" style="background-color: #F0987E; font-size: 0; line-height: 0;">&nbsp;</td>
          <td width="50" height="3" style="background-color: #EDBE4B; font-size: 0; line-height: 0;">&nbsp;</td>
          <td width="50" height="3" style="background-color: #7C6FD9; font-size: 0; line-height: 0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding-top: 6px;">
      <a href="${bookingUrl}" target="_blank" style="color: #6b7280; font-size: 12px; text-decoration: none;">${bookingUrl.replace(/^https?:\/\//, "")}</a>
    </td>
  </tr>
</table>`,
    [bookingUrl]
  );

  async function copyRich() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([`Book time with me: ${bookingUrl}`], { type: "text/plain" }),
        }),
      ]);
      setCopied("rich");
    } catch {
      // Safari fallback: select the rendered preview and copy.
      const node = previewRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand("copy");
        sel?.removeAllRanges();
        setCopied("rich");
      }
    }
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(html);
    setCopied("html");
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div>
      <div
        ref={previewRef}
        className="rounded-lg border border-gray-200 bg-white p-4"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={copyRich}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          {copied === "rich" ? "Copied ✓" : "Copy signature"}
        </button>
        <button
          onClick={copyHtml}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {copied === "html" ? "Copied ✓" : "Copy HTML code"}
        </button>
        <p className="text-xs text-gray-400">
          “Copy signature” pastes ready-made into Outlook / Apple Mail signature settings.
        </p>
      </div>
    </div>
  );
}
