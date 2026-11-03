import { fail, json, rateLimit, readJson, recordAudit } from "@/lib/api";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { getRubric } from "@/lib/judging";

export const dynamic = "force-dynamic";

type Entry = { key?: unknown; score?: unknown };
type Item = { assignmentId?: unknown; comment?: unknown; entries?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await apiRole("judge");
  if (!session?.subjectId) return fail("Sign in as a judge", 401);

  const limit = await rateLimit(
    `scores:${session.subjectId}`,
    Number(process.env.SCORE_RATE_LIMIT_PER_MIN) || 240,
  );
  if (!limit.ok) return fail("Too many sync requests", 429);

  const body = await readJson(request);
  const items = Array.isArray(body.items) ? (body.items as Item[]) : [];
  if (items.length === 0) return fail("No items to sync");
  if (items.length > 30) return fail("Too many items in one batch", 413);

  const assignmentIds = items
    .map((item) => String(item.assignmentId ?? ""))
    .filter((id) => UUID.test(id));
  if (assignmentIds.length !== items.length) return fail("Invalid assignment id");

  const owned = await q<{ id: string }>(
    `select id from assignments where judge_id = $1 and id = any($2::uuid[])`,
    [session.subjectId, assignmentIds],
  );
  const ownedIds = new Set(owned.map((row) => row.id));
  if (ownedIds.size !== new Set(assignmentIds).size) {
    return fail("One or more assignments are not yours", 403);
  }

  const rubric = await getRubric();
  const maxByKey = new Map(rubric.map((criterion) => [criterion.key, criterion.max_score]));

  type Row = { assignmentId: string; key: string; score: number; comment: string | null };
  const rows: Row[] = [];
  for (const item of items) {
    const assignmentId = String(item.assignmentId);
    const comment =
      typeof item.comment === "string" ? item.comment.trim().slice(0, 1000) || null : null;
    const entries = Array.isArray(item.entries) ? (item.entries as Entry[]) : [];
    for (const entry of entries) {
      const key = String(entry.key ?? "");
      const max = maxByKey.get(key);
      const raw = Number(entry.score);
      if (max === undefined || !Number.isFinite(raw)) {
        return fail(`Invalid score entry for ${key || "unknown criterion"}`);
      }
      rows.push({
        assignmentId,
        key,
        score: Math.min(max, Math.max(0, Math.round(raw * 100) / 100)),
        comment,
      });
    }
  }

  if (rows.length === 0) return fail("No scores in payload");

  // Deterministic client_uuid: retries and edits always land on the same row.
  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 5;
    values.push(row.assignmentId, row.key, row.score, row.comment, `${row.assignmentId}:${row.key}`);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  try {
    await q(
      `insert into scores (assignment_id, rubric_key, score, comment, client_uuid)
       values ${placeholders.join(", ")}
       on conflict (assignment_id, rubric_key) do update set
         score = excluded.score,
         comment = excluded.comment,
         client_uuid = excluded.client_uuid,
         updated_at = now()`,
      values,
    );
  } catch (error) {
    console.error("score sync failed", error);
    return fail("Could not save scores", 500);
  }

  await recordAudit({
    actor: session.label,
    role: "judge",
    action: "scores.sync",
    entity: "assignments",
    entityId: [...ownedIds].join(","),
    payload: { assignments: ownedIds.size, rows: rows.length },
  });

  return json({ ok: true, saved: rows.length });
}
