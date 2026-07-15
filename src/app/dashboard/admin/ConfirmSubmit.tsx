"use client";

/** Submit button that asks for confirmation before submitting its form. */
export default function ConfirmSubmit({
  label,
  confirmText,
  variant = "danger",
}: {
  label: string;
  confirmText: string;
  variant?: "danger" | "neutral";
}) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className={
        variant === "danger"
          ? "rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          : "rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      }
    >
      {label}
    </button>
  );
}
