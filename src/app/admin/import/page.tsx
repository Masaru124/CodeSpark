import Flash from "@/components/Flash";
import { one } from "@/lib/db";
import { importCsv } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import teams" };

const SAMPLE = `team_name,participant_name,email,phone,college,track,team_size,payment_verified,payment_ref
CampusRide,Aarav Sharma,aarav@example.com,9876543210,AMC Engineering College,AI/ML,3,TRUE,UPI-88213455
CampusRide,Diya Nair,diya@example.com,9876543211,AMC Engineering College,AI/ML,3,TRUE,UPI-88213455
MediScan,Rohan Iyer,rohan@example.com,9876543212,PES University,HealthTech,4,FALSE,`;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const counts = await one<{ teams: number; participants: number }>(
    `select (select count(*) from teams)::int as teams,
            (select count(*) from participants)::int as participants`,
  );

  return (
    <div className="max-w-4xl">
      <Flash ok={ok} error={error} />

      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Import registration CSV</h1>
      <p className="mt-1 text-sm text-ink-600">
        Export the Google Sheet as CSV and upload it here. Rows are deduped by email and phone, teams
        are created or updated by name. Re-importing is safe — existing pass tokens never change.
      </p>
      <p className="mt-2 text-xs text-ink-500">
        Currently {counts?.teams ?? 0} teams and {counts?.participants ?? 0} participants.
      </p>

      <form action={importCsv} className="card-pad mt-5 space-y-4">
        <div>
          <label htmlFor="file" className="label">
            CSV file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="block w-full rounded-xl border border-dashed border-ink-300 bg-ink-50 px-3 py-6 text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-spark-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
        </div>
        <div>
          <label htmlFor="csv" className="label">
            …or paste CSV
          </label>
          <textarea
            id="csv"
            name="csv"
            rows={7}
            className="input font-mono text-xs"
            placeholder={SAMPLE}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-500">
            Required: <code className="font-mono">email</code> and a 10-digit{" "}
            <code className="font-mono">phone</code>. Everything else is optional.
          </p>
          <button type="submit" className="btn-primary">
            Import CSV
          </button>
        </div>
      </form>

      <div className="card-pad mt-5">
        <h2 className="text-sm font-bold text-ink-900">Accepted columns</h2>
        <p className="mt-1 text-xs text-ink-500">
          Header aliases such as “Team”, “Project”, “Full Name”, “Mobile” and “Paid” are recognised
          automatically.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["team_name", "Team / project name — groups participants"],
                ["participant_name", "Person's name"],
                ["email", "Unique per person, used as the dedupe key"],
                ["phone", "10-digit mobile, also unique"],
                ["college", "Institution"],
                ["track", "Theme / track"],
                ["team_size", "Declared team size (informational)"],
                ["payment_verified", "TRUE/FALSE/yes/1 — controls pass eligibility"],
                ["payment_ref", "Bank / UPI reference for manual reconciliation"],
                ["is_leader", "Marks the team lead"],
              ].map(([column, meaning]) => (
                <tr key={column}>
                  <td className="font-mono text-xs text-ink-800">{column}</td>
                  <td className="text-ink-600">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
