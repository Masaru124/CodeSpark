import Link from "next/link";
import Flash from "@/components/Flash";
import { q, one } from "@/lib/db";
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
  checked_in: number;
  submissions: number;
  judges: number;
  volunteers: number;
  flags: number;
};

export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const [counts, meals, audit, progress, config] = await Promise.all([
    one<Counts>(
      `select
         (select count(*) from teams)::int as teams,
         (select count(*) from teams where payment_verified)::int as teams_verified,
         (select count(*) from participants)::int as participants,
         (select count(*) from participants p join teams t on t.id = p.team_id
           where t.payment_verified)::int as participants_verified,
         (select count(*) from participants where checked_in_at is not null)::int as checked_in,
         (select count(*) from submissions)::int as submissions,
         (select count(*) from judges where active)::int as judges,
         (select count(*) from volunteers where active)::int as volunteers,
         (select count(*) from submissions where repo_public = false
            or first_commit_at is not null and first_commit_at < $1::timestamptz)::int as flags`,
      ["2026-11-12T09:40:00+05:30"],
    ),
    q<{ key: string; label: string; scans: number }>(
      `select m.key, m.label, count(ms.id)::int as scans
         from meals m left join meal_scans ms on ms.meal_key = m.key
        group by m.key, m.label, m.sort order by m.sort`,
    ),
    q<{ action: string; actor: string; at: string; entity: string | null }>(
      `select action, actor, at, entity from audit_log order by at desc limit 8`,
    ),
    judgingProgress(),
    getConfig(),
  ]);

  const rows = counts ?? {
    teams: 0,
    teams_verified: 0,
    participants: 0,
    participants_verified: 0,
    checked_in: 0,
    submissions: 0,
    judges: 0,
    volunteers: 0,
    flags: 0,
  };

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
          ["Checked in", rows.checked_in, pct(rows.checked_in, rows.participants_verified) + " of verified"],
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

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="card-pad">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Meals served</h2>
            <Link href="/volunteer" className="text-xs font-semibold text-spark-700">
              Scanner →
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-ink-100">
            {meals.map((meal) => {
              const total = Math.max(rows.participants_verified, 1);
              const percent = Math.min(100, Math.round((meal.scans / total) * 100));
              return (
                <li key={meal.key} className="py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-ink-900">{meal.label}</span>
                    <span className="font-mono text-sm tabular-nums text-ink-600">
                      {meal.scans} / {rows.participants_verified}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-spark-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            A second scan for the same participant and meal is rejected by a unique constraint, so
            these numbers cannot double-count.
          </p>
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
