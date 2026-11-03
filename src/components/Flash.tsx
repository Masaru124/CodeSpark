export default function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-5 rounded-xl px-4 py-3 text-sm font-medium ${
        error
          ? "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200"
          : "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
      }`}
    >
      {error || ok}
    </div>
  );
}
