"use client";

import { useEffect, useState } from "react";

/** Hidden timezone input auto-filled from the browser, with a visible read-only hint. */
export default function TimezoneField() {
  const [tz, setTz] = useState("America/Montreal");
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Montreal");
  }, []);
  return (
    <div>
      <input type="hidden" name="timezone" value={tz} />
      <p className="text-xs text-gray-400">Timezone: {tz} (change later in Availability)</p>
    </div>
  );
}
