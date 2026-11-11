import Link from "next/link";
import Flash from "@/components/Flash";
import PrintButton from "@/components/PrintButton";
import { one, q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { computeRankings, findOutliers, getRubric, judgingProgress } from "@/lib/judging";
import { fmtDateTime, fmtScore, pct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Statistics & report" };

type Counts = {
  teams: number;
  verified_teams: number;
  participants: number;
  checked_in: number;
  teams_checked_in: number;
  submissions: number;
  flags: number;
  judges: number;
  volunteers: number;
  assignments: number;
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const config = await getConfig(true);

  const [counts, progress, rankings, rubric, outliers] = await Promise.all([
    one<Counts>(
      `select
         (select count(*) from teams)::int as teams,
         (select count(*) from teams where payment_verified)::int as verified_teams,
         (select count(*) from participants)::int as participants,
         (select count(*) from participants where checked_in_at is not null)::int as checked_in,
         (select count(distinct p.team_id) from participants p
           where p.checked_in_at is not null)::int as teams_checked_in,
         (select count(*) from submissions)::int as submissions,
         (select count(*) from submissions where repo_public is false
            or (first_commit_at is not null and first_commit_at < $1::timestamptz))::int as flags,
         (select count(*) from judges where active)::int as judges,
         (select count(*) from volunteers where active)::int as volunteers,
         (select count(*) from assignments)::int as assignments`,
      [config.event.hack_start],
    ),
    judgingProgress(),
    computeRankings(),
    getRubric(),
    findOutliers(config.judging.outlier_threshold),
  ]);

  const numbers = counts ?? {
    teams: 0,
    verified_teams: 0,
    participants: 0,
    checked_in: 0,
    teams_checked_in: 0,
    submissions: 0,
    flags: 0,
    judges: 0,
    volunteers: 0,
    assignments: 0,
  };

  const phase = (round: string) => {
    const rows = progress.filter((row) => row.round === round);
    return {
      teams: rows.length,
      assignments: rows.reduce((sum, row) => sum + row.judges, 0),
      complete: rows.reduce((sum, row) => sum + row.complete, 0),
      covered: rows.filter((row) => row.complete >= 2).length,
    };
  };
  const phase1 = phase("screening");
  const phase2 = phase("final");

  const scored = rankings.filter((team) => team.screening !== null || team.final !== null);
  const bothPhases = rankings.filter((team) => team.screening !== null && team.final !== null);
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const totalMean = mean(scored.map((team) => team.total));
  const totalScores = scored.map((team) => team.total).sort((a, b) => b - a);
  const median = totalScores.length
    ? totalScores[Math.floor((totalScores.length - 1) / 2)]
    : 0;

  const tracks = new Map<string, { teams: number; scored: number; total: number }>();
  for (const team of rankings) {
    const key = team.track ?? "Unassigned";
    const entry = tracks.get(key) ?? { teams: 0, scored: 0, total: 0 };
    entry.teams += 1;
    if (team.screening !== null || team.final !== null) {
      entry.scored += 1;
      entry.total += team.total;
    }
    tracks.set(key, entry);
  }
  const trackRows = [...tracks.entries()]
    .map(([track, entry]) => ({
      track,
      teams: entry.teams,
      scored: entry.scored,
      average: entry.scored ? entry.total / entry.scored : null,
    }))
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.track.localeCompare(b.track));

  const top = [...rankings]
    .filter((team) => team.screening !== null || team.final !== null)
    .slice(0, 10);

  const cards: Array<[string, string, string]> = [
    ["Teams", String(numbers.teams), `${numbers.verified_teams} payment verified`],
    [
      "Check-in (lead)",
      `${numbers.teams_checked_in}/${numbers.teams}`,
      `${numbers.checked_in} people · ${pct(numbers.teams_checked_in, numbers.teams)} of teams`,
    ],
    ["Submissions", String(numbers.submissions), `${numbers.flags} repo flags`],
    ["Judges", String(numbers.judges), `${numbers.volunteers} volunteers · ${numbers.assignments} assignments`],
    ["Phase 1 sheets", `${phase1.complete}/${phase1.assignments}`, `${phase1.covered} teams with 2+ complete`],
    ["Phase 2 sheets", `${phase2.complete}/${phase2.assignments}`, `${phase2.covered} finalist teams with 2+ complete`],
    ["Scored teams", `${scored.length}/${rankings.length}`, `${bothPhases.length} have both phases`],
    ["Mean / median total", `${fmtScore(totalMean)} / ${fmtScore(median)}`, `outliers ±${config.judging.outlier_threshold}: ${outliers.length}`],
  ];

  return (
    <div className="space-y-7">
      <Flash ok={ok} error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Statistics &amp; report</h1>
          <p className="mt-1 text-sm text-ink-600">
            {config.event.name} · generated {fmtDateTime(new Date().toISOString())} ·{" "}
            {config.publish.published ? "results published" : "results not published"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <a href="/api/admin/export?type=results" className="btn-secondary">
            Export results
          </a>
          <a href="/api/admin/export?type=submissions" className="btn-secondary">
            Export submissions
          </a>
          <a href="/api/admin/export?type=scores" className="btn-secondary">
            Export scores
          </a>
          <Link href="/admin/export" className="btn-secondary">
            All exports
          </Link>
          <PrintButton label="Print report" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="stat">
            <p className="stat-label">{label}</p>
            <p className="stat-value">{value}</p>
            <p className="mt-1 text-xs text-ink-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5">
        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            Phase coverage
          </h2>
          <table className="table mt-3">
            <thead>
              <tr>
                <th>Phase</th>
                <th className="text-right">Teams</th>
                <th className="text-right">Sheets</th>
                <th className="text-right">2+ complete</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium text-ink-900">Phase 1 · screening</td>
                <td className="text-right font-mono tabular-nums">{phase1.teams}</td>
                <td className="text-right font-mono tabular-nums">
                  {phase1.complete}/{phase1.assignments}
                </td>
                <td className="text-right font-mono tabular-nums">{phase1.covered}</td>
              </tr>
              <tr>
                <td className="font-medium text-ink-900">Phase 2 · finalist</td>
                <td className="text-right font-mono tabular-nums">{phase2.teams}</td>
                <td className="text-right font-mono tabular-nums">
                  {phase2.complete}/{phase2.assignments}
                </td>
                <td className="text-right font-mono tabular-nums">{phase2.covered}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-ink-500">
            Blend: finalist {Math.round(config.judging.final_weight * 100)}% · screening{" "}
            {Math.round(config.judging.screening_weight * 100)}%. Rubric:{" "}
            {rubric.map((criterion) => `${criterion.label} ${criterion.weight}%`).join(" · ")}.
          </p>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Top 10 · both phases</h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th className="w-12 text-right">#</th>
                <th>Team</th>
                <th>College / track</th>
                <th className="text-right">Phase 1</th>
                <th className="text-right">Phase 2</th>
                <th className="text-right">Total</th>
                <th className="text-right">Judges</th>
              </tr>
            </thead>
            <tbody>
              {top.map((team) => (
                <tr key={team.teamId}>
                  <td className="text-right font-mono font-semibold tabular-nums">{team.rank}</td>
                  <td className="font-medium text-ink-900">{team.name}</td>
                  <td className="text-xs text-ink-500">
                    {team.college ?? "—"}
                    {team.track ? ` · ${team.track}` : ""}
                  </td>
                  <td className="text-right font-mono tabular-nums">{fmtScore(team.screening)}</td>
                  <td className="text-right font-mono tabular-nums">{fmtScore(team.final)}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {fmtScore(team.total)}
                  </td>
                  <td className="text-right text-xs text-ink-500">
                    {team.judgesScreening}p{team.judgesFinal ? ` / ${team.judgesFinal}f` : ""}
                  </td>
                </tr>
              ))}
              {top.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-ink-500">
                    No completed score sheets yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Track averages</h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Track</th>
                <th className="text-right">Teams</th>
                <th className="text-right">Scored</th>
                <th className="text-right">Average total</th>
              </tr>
            </thead>
            <tbody>
              {trackRows.map((row) => (
                <tr key={row.track}>
                  <td className="font-medium text-ink-900">{row.track}</td>
                  <td className="text-right font-mono tabular-nums">{row.teams}</td>
                  <td className="text-right font-mono tabular-nums">{row.scored}</td>
                  <td className="text-right font-mono tabular-nums">{fmtScore(row.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-ink-500">
        This report reads live data. Use Print report for a signed PDF copy, or export the underlying
        tables from <Link href="/admin/export" className="link">Export</Link>.
      </p>
    </div>
  );
}
