"use client";

export default function PrintButton({ label = "Print passes" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
