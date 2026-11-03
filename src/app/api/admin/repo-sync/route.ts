import { fail, json, readJson, recordAudit } from "@/lib/api";
import { getSession } from "@/lib/session";
import { syncRepoBatch, syncTeamRepo } from "@/lib/repoTracker";

export const dynamic = "force-dynamic";

/** Constant-time-ish compare: hash both sides before diffing the bytes. */
async function sameSecret(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Scheduled or manual repo sync.
 * Auth: an admin session, or the `x-repo-sync-token` header matching
 * REPO_SYNC_TOKEN so an external cron can call it.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const expected = process.env.REPO_SYNC_TOKEN;
  const provided = request.headers.get("x-repo-sync-token") ?? "";

  const authorized =
    session?.role === "admin" || (expected ? await sameSecret(provided, expected) : false);
  if (!authorized) return fail("Unauthorized", 401);

  const body = await readJson(request);
  const actor = session?.label ?? "schedule";
  const role = session?.role ?? "admin";

  if (typeof body.teamId === "string" && body.teamId.length > 0) {
    const result = await syncTeamRepo(body.teamId);
    await recordAudit({
      actor,
      role,
      action: "repo.sync",
      entity: "team",
      entityId: body.teamId,
      payload: { ok: result.ok, commits: result.commits, error: result.error },
    });
    return json({ ok: result.ok, result });
  }

  const limit = Number(body.limit ?? 15);
  const summary = await syncRepoBatch(Number.isFinite(limit) ? limit : 15);
  await recordAudit({
    actor,
    role,
    action: "repo.sync.batch",
    payload: {
      checked: summary.checked,
      ok: summary.ok,
      failed: summary.failed,
      commits: summary.commits,
      stopped: summary.stopped,
      remaining: summary.rateLimit.remaining,
    },
  });

  return json({ ok: true, summary });
}
