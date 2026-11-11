import Link from "next/link";
import Flash from "@/components/Flash";
import { one } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { judgingProgress } from "@/lib/judging";
import { fmtDateTime, pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

type Counts = {
  teams: number;
  teams_verified: number;
  participants: number;
  participants_verified: number;
  teams_checked_in: number;
  submissions: number;
  judges: number;
  volunteers: number;
  flags: number;
};

type AuditRow = { action: string; actor: string; at: string; entity: string | null };

export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const [summary, progress, config] = await Promise.all([
    one<Counts & { audit: AuditRow[] }>(
      // Counters and recent activity in one statement: under load each extra
      // Neon query is another HTTPS round trip.
      `select
         (select count(*) from teams)::int as teams,
         (select count(*) from teams where payment_verified)::int as teams_verified,
         (select count(*) from participants)::int as participants,
         (select count(*) from participants p join teams t on t.id = p.team_id
           where t.payment_verified)::int as participants_verified,
         (select count(distinct p.team_id) from participants p
           where p.checked_in_at is not null)::int as teams_checked_in,
         (select count(*) from submissions)::int as submissions,
         (select count(*) from judges where active)::int as judges,
         (select count(*) from volunteers where active)::int as volunteers,
         (select count(*) from submissions where repo_public = false
            or first_commit_at is not null and first_commit_at < $1::timestamptz)::int as flags,
         (select coalesce(json_agg(row_to_json(a)), '[]'::json) from (
            select action, actor, at, entity from audit_log order by at desc limit 8) a) as audit`,
      ["2026-11-12T09:40:00+05:30"],
    ),
    judgingProgress(),
    getConfig(),
  ]);

  const rows = summary ?? {
    teams: 0,
    teams_verified: 0,
    participants: 0,
    participants_verified: 0,
    teams_checked_in: 0,
    submissions: 0,
    judges: 0,
    volunteers: 0,
    flags: 0,
    audit: [],
  };
  const audit = rows.audit;

  const assignments = progress.reduce((sum, row) => sum + row.judges, 0);
  const complete = progress.reduce((sum, row) => sum + row.complete, 0);
  const teamsWithTwo = new Set(progress.filter((row) => row.complete >= 2).map((row) => row.teamId)).size;

  return (
    <div className="space-y-7">
      <Flash ok={ok} error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Event overview</h1>
          <p className="mt-1 text-sm text-ink-600">
            {config.event.name} · {fmtDateTime(config.event.starts_at)} ·{" "}
            {config.publish.published
              ? `results published ${fmtDateTime(config.publish.published_at)}`
              : "results not published"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/volunteer" className="btn-secondary">
            Open scanner
          </Link>
          <Link href="/admin/import" className="btn-primary">
            Import teams
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Participants", rows.participants, `${rows.participants_verified} on verified teams`],
          [
            "Teams checked in",
            `${rows.teams_checked_in}/${rows.teams}`,
            pct(rows.teams_checked_in, rows.teams) + " of teams · lead only",
          ],
          ["Submissions", rows.submissions, `${rows.flags} repo flags`],
          ["Judging coverage", `${complete}/${assignments}`, `${teamsWithTwo}/${rows.teams_verified} teams at 2+ sheets`],
        ].map(([label, value, hint]) => (
          <div key={String(label)} className="stat">
            <p className="stat-label">{label}</p>
            <p className="stat-value">{value}</p>
            <p className="mt-1 text-xs text-ink-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-pad">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Check-in</h2>
            <Link href="/volunteer" className="text-xs font-semibold text-spark-700">
              Scanner →
            </Link>
          </div>
          <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-ink-900">
            {rows.teams_checked_in}
            <span className="text-sm font-normal text-ink-400"> / {rows.teams} teams</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-spark-500"
              style={{ width: `${Math.min(100, Math.round((rows.teams_checked_in / Math.max(rows.teams, 1)) * 100))}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            The team QR checks in the <strong>team lead only</strong>; the rest of the team is not
            marked present. Meals are not scanned at this event.
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-ink-600">Teams not yet checked in</dt>
              <dd className="font-mono font-semibold tabular-nums text-ink-900">
                {Math.max(0, rows.teams - rows.teams_checked_in)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-600">Leads on verified teams checked in</dt>
              <dd className="font-mono font-semibold tabular-nums text-ink-900">
                {pct(rows.teams_checked_in, rows.teams)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Teams</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Registered teams", rows.teams],
              ["Payment verified", rows.teams_verified],
              ["Awaiting verification", rows.teams - rows.teams_verified],
              ["Active judges", rows.judges],
              ["Active volunteers", rows.volunteers],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between">
                <dt className="text-ink-600">{label}</dt>
                <dd className="font-mono font-semibold tabular-nums text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/teams" className="btn-secondary text-xs">
              Verify payments
            </Link>
            <Link href="/admin/judging" className="btn-secondary text-xs">
              Assign judges
            </Link>
          </div>
        </section>
      </div>

      <section className="card-pad">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Recent activity</h2>
          <Link href="/admin/audit" className="text-xs font-semibold text-spark-700">
            Full audit log →
          </Link>
        </div>
        {audit.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">No actions recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 text-sm">
            {audit.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-mono text-xs text-ink-700">{entry.action}</span>
                <span className="text-ink-500">
                  {entry.actor} · {fmtDateTime(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
