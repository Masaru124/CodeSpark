import Link from "next/link";
import { q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { fmtDateTime, fmtScore } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

type ResultRow = {
  team_id: string;
  name: string;
  college: string | null;
  track: string | null;
  rank: number;
  screening_total: number | null;
  final_total: number | null;
};

// Everyone refreshes this page the moment results are announced. A short
// per-isolate cache turns that spike into memory hits instead of one query
// per phone; publishing still lands within a few seconds everywhere.
const RESULTS_CACHE_TTL_MS = 5_000;
let resultsCache: { at: number; rows: ResultRow[] } | null = null;

async function publishedResults(): Promise<ResultRow[]> {
  if (resultsCache && Date.now() - resultsCache.at < RESULTS_CACHE_TTL_MS) return resultsCache.rows;
  const rows = await q<ResultRow>(
    `select r.team_id, t.name, t.college, t.track, r.rank,
            r.screening_total::float, r.final_total::float
       from results r join teams t on t.id = r.team_id
      where r.published = true
      order by r.rank asc`,
  );
  resultsCache = { at: Date.now(), rows };
  return rows;
}

export default async function PublicResultsPage() {
  const config = await getConfig();

  if (!config.publish.published) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <div className="card-pad max-w-lg text-center">
          <p className="text-3xl">⏳</p>
          <h1 className="mt-3 text-2xl font-bold text-ink-900">Results not announced yet</h1>
          <p className="mt-2 text-sm text-ink-600">
            Winners are announced at {fmtDateTime(config.event.results_at)}. This page unlocks the
            moment the organisers publish the ranking.
          </p>
          <Link href="/" className="btn-secondary mt-4">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const rows = await publishedResults();

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <main className="min-h-screen bg-ink-50 pb-14">
      <header className="border-b border-ink-200 bg-white">
        <div className="container-page flex h-16 items-center justify-between">
          <span className="text-sm font-bold text-ink-900">⚡ {config.event.name}</span>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>Published {fmtDateTime(config.publish.published_at)}</span>
            <Link href="/login" className="link">
              Staff
            </Link>
          </div>
        </div>
      </header>

      <div className="container-page pt-10">
        <p className="badge-info">Final standings</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-ink-900 sm:text-4xl">
          {config.event.name} winners
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Weighted rubric across {rows.length} teams. Screening round 30%, finalist round 70%; ties
          broken on technical depth, then working demo.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {podium.map((team) => (
            <div
              key={team.team_id}
              className={`card-pad ${team.rank === 1 ? "ring-2 ring-spark-400" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl font-black text-spark-600">#{team.rank}</span>
                <span className="text-2xl">{team.rank === 1 ? "🏆" : team.rank === 2 ? "🥈" : "🥉"}</span>
              </div>
              <h2 className="mt-2 text-lg font-bold text-ink-900">{team.name}</h2>
              <p className="text-xs text-ink-500">
                {team.college ?? "—"}
                {team.track ? ` · ${team.track}` : ""}
              </p>
              <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-ink-900">
                {fmtScore(team.final_total ?? team.screening_total)}
                <span className="ml-1 text-xs font-normal text-ink-400">/ 100</span>
              </p>
            </div>
          ))}
        </div>

        {rest.length > 0 ? (
          <div className="table-wrap mt-8">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16 text-right">Rank</th>
                  <th>Team</th>
                  <th>College</th>
                  <th>Track</th>
                  <th className="text-right">Screening</th>
                  <th className="text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((team) => (
                  <tr key={team.team_id}>
                    <td className="text-right font-mono font-semibold tabular-nums">{team.rank}</td>
                    <td className="font-medium text-ink-900">{team.name}</td>
                    <td className="text-ink-600">{team.college ?? "—"}</td>
                    <td className="text-ink-600">{team.track ?? "—"}</td>
                    <td className="text-right font-mono tabular-nums">{fmtScore(team.screening_total)}</td>
                    <td className="text-right font-mono tabular-nums">{fmtScore(team.final_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="mt-8 text-xs text-ink-500">
          Every team can open its own pass link to see its rubric score sheet. Disputes go to the tech
          desk within 24 hours.
        </p>
      </div>
    </main>
  );
}
