import Link from "next/link";
import Flash from "@/components/Flash";
import { q, one } from "@/lib/db";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { syncRepoNow, syncReposNow } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repo tracker" };

type TrackedRepo = {
  team_id: string;
  team_name: string;
  repo_url: string;
  repo_full_name: string | null;
  repo_public: boolean | null;
  default_branch: string | null;
  stars: number;
  forks: number;
  open_issues: number;
  total_commits: number | null;
  authors: number;
  first_commit_at: string | null;
  last_commit_at: string | null;
  last_checked_at: string | null;
  error: string | null;
  tracked_commits: number;
  commits_24h: number;
  commits_7d: number;
};

type CommitRow = {
  sha: string;
  author: string | null;
  message: string;
  committed_at: string;
  team_id: string;
  team_name: string;
};

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const [repos, commits, missing] = await Promise.all([
    q<TrackedRepo>(
      `with tracked as (
         select t.id as team_id, t.name as team_name, s.repo_url,
                rs.repo_full_name, rs.repo_public, rs.default_branch,
                coalesce(rs.stars, 0) as stars,
                coalesce(rs.forks, 0) as forks,
                coalesce(rs.open_issues, 0) as open_issues,
                rs.total_commits,
                coalesce(rs.authors, 0) as authors,
                rs.first_commit_at, rs.last_commit_at, rs.last_checked_at, rs.error,
                (select count(*) from repo_commits c where c.team_id = t.id)::int as tracked_commits,
                (select count(*) from repo_commits c
                  where c.team_id = t.id and c.committed_at > now() - interval '24 hours')::int as commits_24h,
                (select count(*) from repo_commits c
                  where c.team_id = t.id and c.committed_at > now() - interval '7 days')::int as commits_7d
           from submissions s
           join teams t on t.id = s.team_id
           left join repo_stats rs on rs.team_id = t.id
       )
       select * from tracked
       order by commits_24h desc, commits_7d desc, team_name
       limit 500`,
    ),
    q<CommitRow>(
      `select c.sha, c.author, c.message, c.committed_at, t.id as team_id, t.name as team_name
         from repo_commits c join teams t on t.id = c.team_id
        order by c.committed_at desc
        limit 25`,
    ),
    one<{ n: number }>(
      `select count(*)::int as n from teams t
        where not exists (select 1 from submissions s where s.team_id = t.id)`,
    ),
  ]);

  const synced = repos.filter((repo) => repo.last_checked_at !== null);
  const publicRepos = repos.filter((repo) => repo.repo_public === true).length;
  const failing = repos.filter((repo) => repo.error !== null);
  const commits24h = repos.reduce((sum, repo) => sum + repo.commits_24h, 0);
  const commits7d = repos.reduce((sum, repo) => sum + repo.commits_7d, 0);
  const trackedTotal = repos.reduce((sum, repo) => sum + repo.tracked_commits, 0);
  const tokenConfigured = Boolean(process.env.GITHUB_TOKEN);

  return (
    <div className="space-y-7">
      <Flash ok={ok} error={error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Repo tracker</h1>
          <p className="mt-1 text-sm text-ink-600">
            Commit activity for every submitted repository · {synced.length}/{repos.length} synced
            {missing?.n ? ` · ${missing.n} teams have not submitted a repo` : ""}
          </p>
        </div>
        <form action={syncReposNow} className="flex items-end gap-2">
          <div>
            <label htmlFor="limit" className="label">
              Batch
            </label>
            <select id="limit" name="limit" defaultValue="15" className="input w-28">
              <option value="5">5 repos</option>
              <option value="15">15 repos</option>
              <option value="30">30 repos</option>
              <option value="60">60 repos</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Sync now
          </button>
        </form>
      </div>

      {!tokenConfigured ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>No GITHUB_TOKEN set.</strong> Unauthenticated GitHub allows 60 requests/hour, which
          is roughly 20 repo syncs. Add a fine-grained read-only token to <code>GITHUB_TOKEN</code>{" "}
          for 5000/hour, then sync in batches of 60.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Repositories", repos.length, `${publicRepos} public · ${repos.length - publicRepos} private or unknown`],
          ["Commits tracked", trackedTotal, `${commits7d} in the last 7 days`],
          ["Last 24 hours", commits24h, `${synced.length} repos checked at least once`],
          ["Needs attention", failing.length, failing.length ? "Not public, missing or rate-limited" : "No repo errors"],
        ].map(([label, value, hint]) => (
          <div key={String(label)} className="stat">
            <p className="stat-label">{label}</p>
            <p className="stat-value">{value}</p>
            <p className="mt-1 text-xs text-ink-500">{hint}</p>
          </div>
        ))}
      </div>

      {repos.length === 0 ? (
        <div className="card-pad text-sm text-ink-600">
          No repositories submitted yet. Teams add theirs from their pass page, and the tracker picks
          them up here.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Repository</th>
                <th className="text-right">24h</th>
                <th className="text-right">7d</th>
                <th className="text-right">Tracked</th>
                <th>Last commit</th>
                <th className="text-right">Authors</th>
                <th>Checked</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <tr key={repo.team_id}>
                  <td>
                    <Link
                      href={`/admin/teams/${repo.team_id}`}
                      className="font-semibold text-ink-900 hover:text-spark-700"
                    >
                      {repo.team_name}
                    </Link>
                    {repo.default_branch ? (
                      <span className="block font-mono text-xs text-ink-400">{repo.default_branch}</span>
                    ) : null}
                  </td>
                  <td className="max-w-xs">
                    <a
                      href={repo.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-spark-700 underline-offset-2 hover:underline"
                    >
                      {repo.repo_full_name ?? repo.repo_url}
                    </a>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {repo.repo_public === false ? (
                        <span className="badge-bad">Not public</span>
                      ) : repo.repo_public === true ? (
                        <span className="badge-ok">Public</span>
                      ) : (
                        <span className="badge-neutral">Unknown</span>
                      )}
                      {repo.stars > 0 ? (
                        <span className="text-xs text-ink-400">★ {repo.stars}</span>
                      ) : null}
                      {repo.error ? (
                        <span className="text-xs font-medium text-rose-700">{repo.error}</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="text-right font-mono tabular-nums">{repo.commits_24h}</td>
                  <td className="text-right font-mono tabular-nums">{repo.commits_7d}</td>
                  <td className="text-right font-mono tabular-nums">
                    {repo.tracked_commits}
                    {repo.total_commits !== null ? (
                      <span className="text-ink-400">/{repo.total_commits}</span>
                    ) : null}
                  </td>
                  <td className="text-xs text-ink-600">
                    {repo.last_commit_at ? (
                      <>
                        {fmtAgo(repo.last_commit_at)}
                        <span className="block text-ink-400">{fmtDateTime(repo.last_commit_at)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right font-mono tabular-nums">{repo.authors}</td>
                  <td className="text-xs text-ink-600">
                    {repo.last_checked_at ? fmtAgo(repo.last_checked_at) : "never"}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <form action={syncRepoNow}>
                        <input type="hidden" name="teamId" value={repo.team_id} />
                        <button type="submit" className="btn-ghost text-xs">
                          Sync
                        </button>
                      </form>
                      <a href={repo.repo_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                        Open
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Latest commits</h2>
        <p className="mt-1 text-xs text-ink-500">
          The newest 25 commits across every tracked repository, refreshed on each sync.
        </p>
        {commits.length === 0 ? (
          <div className="card-pad mt-3 text-sm text-ink-600">
            Nothing tracked yet. Run a sync to pull commit history.
          </div>
        ) : (
          <ul className="card mt-3 divide-y divide-ink-100">
            {commits.map((commit) => (
              <li key={`${commit.team_id}-${commit.sha}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <Link href={`/admin/teams/${commit.team_id}`} className="font-semibold text-ink-900">
                  {commit.team_name}
                </Link>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{commit.message}</span>
                <span className="text-xs text-ink-500">{commit.author ?? "unknown"}</span>
                <span className="text-xs text-ink-400">{fmtAgo(commit.committed_at)}</span>
                <span className="font-mono text-[11px] text-ink-400">{commit.sha.slice(0, 7)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-ink-500">
        Automated refresh: <code>POST /api/admin/repo-sync</code> with the{" "}
        <code>x-repo-sync-token</code> header (set <code>REPO_SYNC_TOKEN</code>) or an admin session.
        Bodies accept <code>{`{"limit": 60}`}</code> for a batch sweep, or{" "}
        <code>{`{"teamId": "…"}`}</code> for one repository.
      </p>
    </div>
  );
}
