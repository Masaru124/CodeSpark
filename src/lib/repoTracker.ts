import { one, q } from "@/lib/db";
import {
  fetchRepoActivity,
  rateLimitWarning,
  type RepoCommit,
  type RepoRateLimit,
} from "@/lib/github";

export type RepoSyncResult = {
  teamId: string;
  team: string;
  ok: boolean;
  commits: number;
  totalCommits: number | null;
  error: string | null;
  rateLimit: RepoRateLimit;
};

export type RepoSyncSummary = {
  checked: number;
  ok: number;
  failed: number;
  commits: number;
  stopped: boolean;
  rateLimit: RepoRateLimit;
  warning: string | null;
  results: RepoSyncResult[];
};

const CONCURRENCY = 4;
/** Stop the batch once GitHub is nearly dry instead of burning 403s. */
const RATE_FLOOR = 3;

const EMPTY_RATE: RepoRateLimit = { limit: null, remaining: null, resetAt: null };

/** Lowest remaining quota seen, latest reset time. */
function mergeRate(a: RepoRateLimit, b: RepoRateLimit): RepoRateLimit {
  const remaining =
    a.remaining === null ? b.remaining : b.remaining === null ? a.remaining : Math.min(a.remaining, b.remaining);
  return {
    limit: a.limit ?? b.limit,
    remaining,
    resetAt: b.resetAt ?? a.resetAt,
  };
}

/** Multi-row upsert: a re-sync of the same commit only refreshes its text. */
async function saveCommits(teamId: string, commits: RepoCommit[]) {
  if (commits.length === 0) return;
  const values: unknown[] = [teamId];
  const tuples = commits.map((commit, index) => {
    const base = index * 4;
    values.push(commit.sha, commit.author, commit.message, commit.committedAt);
    return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  await q(
    `insert into repo_commits (team_id, sha, author, message, committed_at)
     values ${tuples.join(", ")}
     on conflict (team_id, sha) do update set
       author = excluded.author,
       message = excluded.message,
       committed_at = excluded.committed_at`,
    values,
  );
}

/**
 * Pull one team's repository and store its state + commit history.
 * Never throws: every failure becomes `repo_stats.error` and a result object.
 */
export async function syncTeamRepo(teamId: string): Promise<RepoSyncResult> {
  const row = await one<{ team: string; repo_url: string; first_commit_at: string | null }>(
    `select t.name as team, s.repo_url, s.first_commit_at
       from submissions s join teams t on t.id = s.team_id
      where s.team_id = $1`,
    [teamId],
  );

  if (!row) {
    return {
      teamId,
      team: "—",
      ok: false,
      commits: 0,
      totalCommits: null,
      error: "No repository submitted",
      rateLimit: EMPTY_RATE,
    };
  }

  const activity = await fetchRepoActivity(row.repo_url, {
    withFirstCommit: !row.first_commit_at,
  });

  const authors = new Set(activity.commits.map((commit) => commit.author).filter(Boolean)).size;
  const ok = activity.error === null;

  await q(
    `insert into repo_stats (team_id, repo_full_name, default_branch, repo_public, stars, forks,
                             open_issues, total_commits, authors, first_commit_at, last_commit_at,
                             last_checked_at, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
     on conflict (team_id) do update set
       repo_full_name = excluded.repo_full_name,
       default_branch = excluded.default_branch,
       repo_public = excluded.repo_public,
       stars = excluded.stars,
       forks = excluded.forks,
       open_issues = excluded.open_issues,
       total_commits = coalesce(excluded.total_commits, repo_stats.total_commits),
       authors = greatest(excluded.authors, repo_stats.authors),
       first_commit_at = coalesce(repo_stats.first_commit_at, excluded.first_commit_at),
       last_commit_at = coalesce(excluded.last_commit_at, repo_stats.last_commit_at),
       last_checked_at = now(),
       error = excluded.error`,
    [
      teamId,
      activity.repoFullName,
      activity.defaultBranch,
      activity.repoPublic,
      activity.stars,
      activity.forks,
      activity.openIssues,
      activity.totalCommits,
      authors,
      activity.firstCommitAt ?? row.first_commit_at,
      activity.lastCommitAt,
      activity.error,
    ],
  );

  if (ok) await saveCommits(teamId, activity.commits);

  // Keep the submission row the single source of truth for the publish gate.
  await q(
    `update submissions set
       repo_public = coalesce($2, repo_public),
       first_commit_at = coalesce($3, first_commit_at),
       updated_at = now()
     where team_id = $1`,
    [teamId, activity.repoPublic, activity.firstCommitAt],
  );

  return {
    teamId,
    team: row.team,
    ok,
    commits: activity.commits.length,
    totalCommits: activity.totalCommits,
    error: activity.error,
    rateLimit: activity.rateLimit,
  };
}

/**
 * Sync the repositories that were checked longest ago. Bounded concurrency
 * keeps a 60-team sweep inside a normal request while GitHub stays happy.
 */
export async function syncRepoBatch(limit = 15): Promise<RepoSyncSummary> {
  const rows = await q<{ team_id: string }>(
    `select s.team_id
       from submissions s
       left join repo_stats rs on rs.team_id = s.team_id
      order by rs.last_checked_at asc nulls first
      limit $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );

  const queue = rows.map((row) => row.team_id);
  const summary: RepoSyncSummary = {
    checked: 0,
    ok: 0,
    failed: 0,
    commits: 0,
    stopped: false,
    rateLimit: EMPTY_RATE,
    warning: null,
    results: [],
  };

  const worker = async () => {
    for (;;) {
      if (summary.rateLimit.remaining !== null && summary.rateLimit.remaining <= RATE_FLOOR) {
        summary.stopped = true;
        queue.length = 0;
        return;
      }
      const teamId = queue.shift();
      if (!teamId) return;

      const result = await syncTeamRepo(teamId);
      summary.checked += 1;
      summary.commits += result.commits;
      if (result.ok) summary.ok += 1;
      else summary.failed += 1;
      summary.rateLimit = mergeRate(summary.rateLimit, result.rateLimit);
      summary.results.push(result);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  summary.warning = rateLimitWarning(summary.rateLimit);
  return summary;
}
