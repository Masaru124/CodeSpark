import Link from "next/link";
import Flash from "@/components/Flash";
import { q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { computeRankings, getRubric } from "@/lib/judging";
import { fmtDateTime, fmtScore } from "@/lib/format";
import { createFinalistRound, publishResults, recheckRepo, updateEventConfig } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(offset).toISOString().slice(0, 16);
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const config = await getConfig(true);

  const [rankings, rubric, flagged] = await Promise.all([
    computeRankings(),
    getRubric(),
    q<{
      team_id: string;
      team_name: string;
      repo_url: string;
      repo_public: boolean | null;
      first_commit_at: string | null;
      submitted_at: string;
    }>(
      `select s.team_id, t.name as team_name, s.repo_url, s.repo_public, s.first_commit_at, s.submitted_at
         from submissions s join teams t on t.id = s.team_id
        where s.repo_public is false
           or (s.first_commit_at is not null and s.first_commit_at < $1::timestamptz)
        order by t.name`,
      [config.event.hack_start],
    ),
  ]);

  const scored = rankings.filter((team) => team.screening !== null || team.final !== null);
  const unscored = rankings.length - scored.length;

  return (
    <div className="space-y-7">
      <Flash ok={ok} error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Results</h1>
          <p className="mt-1 text-sm text-ink-600">
            {scored.length} teams with scores · {unscored} without ·{" "}
            {config.publish.published
              ? `published ${fmtDateTime(config.publish.published_at)}`
              : "not published"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/admin/export?type=rankings" className="btn-secondary">
            Export rankings
          </a>
          <a href="/api/admin/export?type=scores" className="btn-secondary">
            Export scores
          </a>
          <a href="/api/admin/export?type=scans" className="btn-secondary">
            Export meal scans
          </a>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card-pad">
          <h2 className="text-sm font-bold text-ink-900">Publish</h2>
          <p className="mt-1 text-xs text-ink-500">
            Publishing freezes the ranking and unlocks{" "}
            <Link href="/results" className="link">
              the public leaderboard
            </Link>{" "}
            and each team&apos;s score sheet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={publishResults}>
              <input type="hidden" name="publish" value="true" />
              <button type="submit" className="btn-primary">
                {config.publish.published ? "Republish" : "Publish results"}
              </button>
            </form>
            {config.publish.published ? (
              <form action={publishResults}>
                <input type="hidden" name="publish" value="false" />
                <button type="submit" className="btn-secondary">
                  Unpublish
                </button>
              </form>
            ) : null}
          </div>
          {config.publish.published ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              Live at /results · ranks recomputed on every republish
            </p>
          ) : null}
        </section>

        <form action={createFinalistRound} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Finalist round</h2>
          <p className="text-xs text-ink-500">
            Assigns the top N screening teams to every active judge for the finalist round.
          </p>
          <div>
            <label htmlFor="count" className="label">
              Finalists
            </label>
            <input
              id="count"
              name="count"
              type="number"
              min={1}
              max={30}
              defaultValue={config.judging.finalists}
              className="input"
            />
          </div>
          <button type="submit" className="btn-secondary w-full">
            Create finalist assignments
          </button>
        </form>

        <form action={updateEventConfig} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Rules &amp; weights</h2>
          <div>
            <label htmlFor="submission_deadline" className="label">
              Submission deadline (local time)
            </label>
            <input
              id="submission_deadline"
              name="submission_deadline"
              type="datetime-local"
              defaultValue={toLocalInput(config.event.submission_deadline)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="final_weight" className="label">
              Finalist weight ({Math.round(config.judging.final_weight * 100)}% final /{" "}
              {Math.round(config.judging.screening_weight * 100)}% screening)
            </label>
            <input
              id="final_weight"
              name="final_weight"
              type="number"
              step="0.05"
              min="0.1"
              max="0.95"
              defaultValue={config.judging.final_weight}
              className="input"
            />
          </div>
          <button type="submit" className="btn-secondary w-full">
            Save
          </button>
        </form>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Live ranking</h2>
          <p className="text-xs text-ink-500">
            Rubric:{" "}
            {rubric.map((criterion) => `${criterion.label} ${criterion.weight}%`).join(" · ")}
          </p>
        </div>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th className="w-14 text-right">#</th>
                <th>Team</th>
                <th className="text-right">Screening</th>
                <th className="text-right">Finalist</th>
                <th className="text-right">Total</th>
                <th className="text-right">Judges</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((team) => (
                <tr key={team.teamId} className={team.rank <= 3 && team.total > 0 ? "bg-amber-50/50" : undefined}>
                  <td className="text-right font-mono font-semibold tabular-nums">{team.rank}</td>
                  <td>
                    <span className="font-medium text-ink-900">{team.name}</span>
                    <span className="block text-xs text-ink-400">
                      {team.college ?? "—"}
                      {team.track ? ` · ${team.track}` : ""}
                    </span>
                  </td>
                  <td className="text-right font-mono tabular-nums">{fmtScore(team.screening)}</td>
                  <td className="text-right font-mono tabular-nums">{fmtScore(team.final)}</td>
                  <td className="text-right font-mono font-semibold tabular-nums">
                    {team.screening === null && team.final === null ? (
                      <span className="badge-neutral">No scores</span>
                    ) : (
                      fmtScore(team.total)
                    )}
                  </td>
                  <td className="text-right text-xs text-ink-500">
                    {team.judgesScreening}s{team.judgesFinal ? ` / ${team.judgesFinal}f` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          Submission flags ({flagged.length})
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Private repos, or a first commit before {fmtDateTime(config.event.hack_start)}. These are
          flags for a human decision — the tool never disqualifies a team.
        </p>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Repository</th>
                <th>First commit</th>
                <th>Submitted</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((row) => (
                <tr key={row.team_id}>
                  <td className="font-medium text-ink-900">{row.team_name}</td>
                  <td className="max-w-xs truncate">
                    <a
                      href={row.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-spark-700 underline-offset-2 hover:underline"
                    >
                      {row.repo_url}
                    </a>
                    {row.repo_public === false ? (
                      <span className="ml-2 badge-bad">Not public</span>
                    ) : null}
                  </td>
                  <td className="text-xs text-ink-600">
                    {row.first_commit_at ? fmtDateTime(row.first_commit_at) : "—"}
                  </td>
                  <td className="text-xs text-ink-600">{fmtDateTime(row.submitted_at)}</td>
                  <td className="text-right">
                    <form action={recheckRepo}>
                      <input type="hidden" name="teamId" value={row.team_id} />
                      <button type="submit" className="btn-ghost text-xs">
                        Recheck
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {flagged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-500">
                    No submission flags.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
