import { q } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const entries = await q<{
    id: string;
    actor: string;
    role: string;
    action: string;
    entity: string | null;
    payload: unknown;
    at: string;
  }>(`select id, actor, role, action, entity, payload, at from audit_log order by at desc limit 200`);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Audit log</h1>
      <p className="mt-1 text-sm text-ink-600">
        Every payment verification, assignment, score-affecting action and publish is recorded.
      </p>

      <div className="table-wrap mt-5">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap text-xs text-ink-600">{fmtDateTime(entry.at)}</td>
                <td className="text-sm">
                  {entry.actor}
                  <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase text-ink-500">
                    {entry.role}
                  </span>
                </td>
                <td className="font-mono text-xs text-ink-800">{entry.action}</td>
                <td className="text-xs text-ink-600">{entry.entity ?? "—"}</td>
                <td className="max-w-md truncate font-mono text-[11px] text-ink-500">
                  {entry.payload ? JSON.stringify(entry.payload) : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-ink-500">
                  Nothing logged yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
