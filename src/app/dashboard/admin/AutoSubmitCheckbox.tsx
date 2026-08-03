"use client";

/** A checkbox that submits its enclosing form on change (toggle settings). */
export default function AutoSubmitCheckbox({
  label,
  checked,
}: {
  label: string;
  checked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input
        type="checkbox"
        defaultChecked={checked}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-4 w-4 rounded border-gray-300"
      />
      {label}
    </label>
  );
}
