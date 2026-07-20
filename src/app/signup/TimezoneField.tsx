"use client";

import { useEffect, useState } from "react";

/** Hidden timezone input auto-filled from the browser, with a visible read-only hint. */
export default function TimezoneField({
  hintTemplate = "Timezone: {tz} (change later in Availability)",
}: {
  hintTemplate?: string;
}) {
  const [tz, setTz] = useState("America/Montreal");
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Montreal");
  }, []);
  return (
    <div>
      <input type="hidden" name="timezone" value={tz} />
      <p className="text-xs text-gray-400">{hintTemplate.replace("{tz}", tz)}</p>
    </div>
  );
}
