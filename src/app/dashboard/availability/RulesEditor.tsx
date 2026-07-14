"use client";

import { useState } from "react";

interface Rule {
  weekday: number; // 1=Mon .. 7=Sun
  start_min: number;
  end_min: number;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function fromTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export default function RulesEditor({
  initialRules,
  saveAction,
}: {
  initialRules: Rule[];
  saveAction: (formData: FormData) => void;
}) {
  const [rules, setRules] = useState<Rule[]>(initialRules);

  const update = (idx: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const remove = (idx: number) => setRules((rs) => rs.filter((_, i) => i !== idx));
  const addFor = (weekday: number) =>
    setRules((rs) => [...rs, { weekday, start_min: 9 * 60, end_min: 17 * 60 }]);

  return (
    <form action={saveAction} className="space-y-4">
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <div className="space-y-3">
        {DAYS.map((label, i) => {
          const weekday = i + 1;
          const dayRules = rules
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r.weekday === weekday);
          return (
            <div key={weekday} className="flex gap-4 items-start">
              <div className="w-28 pt-2 text-sm font-medium">{label}</div>
              <div className="flex-1 space-y-2">
                {dayRules.length === 0 && (
                  <div className="pt-2 text-sm text-gray-400">Unavailable</div>
                )}
                {dayRules.map(({ r, idx }) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={toTime(r.start_min)}
                      onChange={(e) => update(idx, { start_min: fromTime(e.target.value) })}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="time"
                      value={toTime(r.end_min)}
                      onChange={(e) => update(idx, { end_min: fromTime(e.target.value) })}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="text-gray-400 hover:text-red-600 px-1"
                      aria-label="Remove window"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addFor(weekday)}
                className="pt-2 text-sm text-blue-600 hover:underline"
              >
                + Add
              </button>
            </div>
          );
        })}
      </div>
      <button className="rounded-lg bg-blue-600 px-5 py-2 text-white font-medium hover:bg-blue-700">
        Save hours
      </button>
    </form>
  );
}
