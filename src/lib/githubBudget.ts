import { one, q } from "@/lib/db";

export type GithubBudget = {
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
  paused: boolean;
  resumeLabel: string | null;
};

const TTL_MS = 5_000;
const IST = "Asia/Kolkata";
let cache: { at: number; value: GithubBudget } | null = null;

export function formatResume(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
  });
}

function evaluate(
  remaining: number | null,
  limit: number | null,
  resetAt: string | null,
): GithubBudget {
  const resetMs = resetAt ? new Date(resetAt).getTime() : null;
  const paused =
    remaining !== null && remaining <= 0 && (resetMs === null || resetMs > Date.now());
  return {
    remaining,
    limit,
    resetAt,
    paused,
    resumeLabel: paused ? formatResume(resetAt) : null,
  };
}

export async function readBudget(force = false): Promise<GithubBudget> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const row = await one<{ remaining: number | null; limit_total: number | null; reset_at: string | null }>(
      `select remaining, limit_total, reset_at from github_state where id = 1`,
    );
    const value = evaluate(row?.remaining ?? null, row?.limit_total ?? null, row?.reset_at ?? null);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    const value = evaluate(null, null, null);
    cache = { at: Date.now(), value };
    return value;
  }
}

/** Persist whatever GitHub just told us, so the next call can back off. */
export async function saveBudget(headers: Headers): Promise<void> {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const limitRaw = headers.get("x-ratelimit-limit");
  const resetRaw = headers.get("x-ratelimit-reset");
  if (remainingRaw === null && resetRaw === null) return;

  const remaining = remainingRaw === null ? null : Number(remainingRaw);
  const limit = limitRaw === null ? null : Number(limitRaw);
  const resetAt = resetRaw ? new Date(Number(resetRaw) * 1000).toISOString() : null;

  cache = { at: Date.now(), value: evaluate(remaining, limit, resetAt) };
  try {
    await q(
      `insert into github_state (id, remaining, limit_total, reset_at, checked_at, updated_at)
       values (1, $1, $2, $3, now(), now())
       on conflict (id) do update set
         remaining = excluded.remaining,
         limit_total = excluded.limit_total,
         reset_at = excluded.reset_at,
         checked_at = now(),
         updated_at = now()`,
      [remaining, limit, resetAt],
    );
  } catch {
    // Budget persistence is best-effort; never break the caller.
  }
}

export async function canSpend(cost: number): Promise<{
  ok: boolean;
  budget: GithubBudget;
  message: string | null;
}> {
  const budget = await readBudget();
  if (budget.paused) {
    return {
      ok: false,
      budget,
      message: `GitHub quota exhausted — paused until ${budget.resumeLabel ?? "the hourly reset"}; showing cached data`,
    };
  }
  if (budget.remaining !== null && budget.remaining < cost) {
    return {
      ok: false,
      budget,
      message: `GitHub quota low (${budget.remaining} left) — resumes ${
        budget.resumeLabel ?? "at the hourly reset"
      }`,
    };
  }
  return { ok: true, budget, message: null };
}
