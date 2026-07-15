"use client";

/** Submit button that asks for confirmation before submitting its form. */
export default function ConfirmSubmit({
  label,
  confirmText,
}: {
  label: string;
  confirmText: string;
}) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
    >
      {label}
    </button>
  );
}
