export type RepoInspection = {
  repoPublic: boolean | null;
  firstCommitAt: string | null;
  error: string | null;
};

export type RepoCommit = {
  sha: string;
  author: string | null;
  message: string;
  committedAt: string;
};

export type RepoRateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
};

export type RepoActivity = {
  repoPublic: boolean | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  totalCommits: number | null;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  commits: RepoCommit[];
  rateLimit: RepoRateLimit;
  error: string | null;
};

const REPO_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i;
const MESSAGE_LIMIT = 200;
const COMMITS_PER_SYNC = 100;

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = REPO_PATTERN.exec(url.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "code-spark-ops",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

const EMPTY_RATE: RepoRateLimit = { limit: null, remaining: null, resetAt: null };

/** Keeps the most pessimistic rate-limit numbers seen during one repo read. */
function readRate(headers: Headers, current: RepoRateLimit): RepoRateLimit {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");

  const nextRemaining = remaining === null ? current.remaining : Number(remaining);
  return {
    limit: limit === null ? current.limit : Number(limit),
    remaining:
      nextRemaining === null
        ? null
        : current.remaining === null
          ? nextRemaining
          : Math.min(current.remaining, nextRemaining),
    resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : current.resetAt,
  };
}

/** GitHub reports the total page count in a Link header: <...&page=7>; rel="last". */
function lastPage(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (!/rel="last"/.test(part)) continue;
    const match = /[?&]page=(\d+)/.exec(part);
    if (match) return Number(match[1]);
  }
  return null;
}

type RawCommit = {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
  author?: { login?: string };
};

function toCommit(raw: RawCommit): RepoCommit | null {
  if (!raw.sha) return null;
  return {
    sha: raw.sha,
    author: raw.author?.login ?? raw.commit?.author?.name ?? null,
    message: (raw.commit?.message ?? "").split("\n")[0].slice(0, MESSAGE_LIMIT),
    committedAt:
      raw.commit?.committer?.date ?? raw.commit?.author?.date ?? new Date().toISOString(),
  };
}

function emptyActivity(error: string | null, rate: RepoRateLimit = EMPTY_RATE): RepoActivity {
  return {
    repoPublic: null,
    repoFullName: null,
    defaultBranch: null,
    stars: 0,
    forks: 0,
    openIssues: 0,
    totalCommits: null,
    firstCommitAt: null,
    lastCommitAt: null,
    commits: [],
    rateLimit: rate,
    error,
  };
}

/**
 * One repo lookup + one earliest-commit lookup. Never throws: a GitHub outage
 * must not block a submission, it only leaves the check "unverified".
 */
export async function inspectRepo(url: string): Promise<RepoInspection> {
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return { repoPublic: null, firstCommitAt: null, error: "Not a GitHub repository URL" };
  }

  try {
    const repoResponse = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(6000), cache: "no-store" },
    );

    if (repoResponse.status === 404) {
      return { repoPublic: false, firstCommitAt: null, error: "Repository not found or private" };
    }
    if (!repoResponse.ok) {
      return { repoPublic: null, firstCommitAt: null, error: `GitHub returned ${repoResponse.status}` };
    }

    const repo = (await repoResponse.json()) as { default_branch?: string };
    const branch = repo.default_branch || "main";

    const commitsResponse = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1&direction=asc`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(6000), cache: "no-store" },
    );

    if (!commitsResponse.ok) {
      return { repoPublic: true, firstCommitAt: null, error: `Commit lookup failed (${commitsResponse.status})` };
    }

    const commits = (await commitsResponse.json()) as Array<{
      commit?: { committer?: { date?: string }; author?: { date?: string } };
    }>;
    const first = commits?.[0]?.commit?.committer?.date ?? commits?.[0]?.commit?.author?.date ?? null;

    return { repoPublic: true, firstCommitAt: first, error: null };
  } catch (error) {
    return {
      repoPublic: null,
      firstCommitAt: null,
      error: error instanceof Error ? error.name : "GitHub lookup failed",
    };
  }
}

/**
 * Full activity snapshot for the tracker: repo metadata, the most recent
 * `COMMITS_PER_SYNC` commits, the lifetime commit count and the first commit.
 * Three requests at most, and the first-commit probe is skipped once known.
 */
export async function fetchRepoActivity(
  url: string,
  options: { withFirstCommit?: boolean } = {},
): Promise<RepoActivity> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return emptyActivity("Not a GitHub repository URL");

  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  let rate = EMPTY_RATE;

  try {
    const repoResponse = await fetch(base, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    rate = readRate(repoResponse.headers, rate);

    if (repoResponse.status === 404) {
      return {
        ...emptyActivity("Repository not found or private", rate),
        repoPublic: false,
        repoFullName: `${parsed.owner}/${parsed.repo}`,
      };
    }
    if (!repoResponse.ok) {
      const limited = repoResponse.status === 403 || repoResponse.status === 429;
      const reset = rate.resetAt
        ? new Date(rate.resetAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })
        : "the hourly reset";
      return {
        ...emptyActivity(
          limited
            ? `GitHub rate limit reached — set GITHUB_TOKEN or retry after ${reset}`
            : `GitHub returned ${repoResponse.status}`,
          rate,
        ),
        repoFullName: `${parsed.owner}/${parsed.repo}`,
      };
    }

    const repo = (await repoResponse.json()) as {
      full_name?: string;
      default_branch?: string;
      stargazers_count?: number;
      forks_count?: number;
      open_issues_count?: number;
      private?: boolean;
    };
    const branch = repo.default_branch || "main";

    const commitsResponse = await fetch(
      `${base}/commits?sha=${encodeURIComponent(branch)}&per_page=${COMMITS_PER_SYNC}`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    rate = readRate(commitsResponse.headers, rate);

    let commits: RepoCommit[] = [];
    let totalCommits: number | null = null;
    let error: string | null = null;

    if (commitsResponse.ok) {
      const raw = (await commitsResponse.json()) as RawCommit[];
      commits = raw.map(toCommit).filter((commit): commit is RepoCommit => commit !== null);
      const pages = lastPage(commitsResponse.headers.get("link"));
      totalCommits = pages ? (pages - 1) * COMMITS_PER_SYNC + commits.length : commits.length;
    } else {
      error = `Commit list unavailable (${commitsResponse.status})`;
    }

    let firstCommitAt: string | null = null;
    if (options.withFirstCommit !== false && commits.length > 0) {
      const firstResponse = await fetch(
        `${base}/commits?sha=${encodeURIComponent(branch)}&per_page=1&direction=asc`,
        { headers: githubHeaders(), signal: AbortSignal.timeout(8000), cache: "no-store" },
      );
      rate = readRate(firstResponse.headers, rate);
      if (firstResponse.ok) {
        const first = (await firstResponse.json()) as RawCommit[];
        firstCommitAt = first?.[0]?.commit?.committer?.date ?? first?.[0]?.commit?.author?.date ?? null;
      }
    }

    return {
      repoPublic: !repo.private,
      repoFullName: repo.full_name ?? `${parsed.owner}/${parsed.repo}`,
      defaultBranch: branch,
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      openIssues: repo.open_issues_count ?? 0,
      totalCommits,
      firstCommitAt,
      lastCommitAt: commits[0]?.committedAt ?? null,
      commits,
      rateLimit: rate,
      error,
    };
  } catch (error) {
    return {
      ...emptyActivity(error instanceof Error ? error.name : "GitHub lookup failed", rate),
      repoFullName: `${parsed.owner}/${parsed.repo}`,
    };
  }
}

export function rateLimitWarning(rate: RepoRateLimit): string | null {
  if (rate.remaining === null || rate.remaining > 5) return null;
  const reset = rate.resetAt ? new Date(rate.resetAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "soon";
  return `GitHub rate limit almost exhausted (${rate.remaining} left, resets ${reset}). Add GITHUB_TOKEN for 5000 requests/hour.`;
}
