import Link from "next/link";
import Flash from "@/components/Flash";
import { q } from "@/lib/db";
import { EXPORTS, EXPORT_GROUPS } from "@/lib/exports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Export data" };

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const entries = await Promise.all(
    Object.entries(EXPORTS).map(async ([key, definition]) => {
      const rows = await q<{ n: number }>(`select count(*)::int as n from (${definition.sql}) export_rows`);
      return { key, definition, count: Number(rows[0]?.n ?? 0) };
    }),
  );

  return (
    <div className="space-y-6">
      <Flash ok={ok} error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Export data</h1>
          <p className="mt-1 text-sm text-ink-600">
            Every stored table is downloadable as CSV. The JSON dump contains the same views in one
            file for archiving.
          </p>
        </div>
        <a href="/api/admin/export?type=all" className="btn-primary">
          Download everything (JSON)
        </a>
      </div>

      {EXPORT_GROUPS.map((group) => {
        const groupEntries = entries.filter((entry) => entry.definition.group === group);
        if (groupEntries.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">{group}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupEntries.map(({ key, definition, count }) => (
                <a
                  key={key}
                  href={`/api/admin/export?type=${key}`}
                  className="card-pad flex items-center justify-between gap-3 transition hover:border-spark-300 hover:shadow"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">{definition.label}</span>
                    <span className="block font-mono text-xs text-ink-500">
                      {count} row{count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-spark-700">CSV ↓</span>
                </a>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-ink-500">
        Need a single ranking sheet?{" "}
        <Link href="/admin/report" className="link">
          The report page
        </Link>{" "}
        prints the same numbers with both phases side by side.
      </p>
    </div>
  );
}
