"use client";

export default function ConfirmSubmitButton({
  label,
  message,
  className = "btn-ghost text-xs",
}: {
  label: string;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
