import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Cloudflare sets cf-connecting-ip; Vercel sets x-forwarded-for. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Fixed-window counter in Postgres. One round trip, no client state, and it is
 * shared by every worker isolate — good enough to stop QR brute force.
 */
export async function rateLimit(
  key: string,
  maxPerMinute: number,
): Promise<{ ok: boolean; count: number }> {
  const rows = await q<{ count: number }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, date_trunc('minute', now()), 1)
     on conflict (key) do update set
       count = case
         when rate_limits.window_start >= date_trunc('minute', now()) then rate_limits.count + 1
         else 1
       end,
       window_start = date_trunc('minute', now())
     returning count`,
    [key],
  );
  const count = Number(rows[0]?.count ?? 1);
  return { ok: count <= maxPerMinute, count };
}

export async function recordAudit(input: {
  actor: string;
  role: string;
  action: string;
  entity?: string;
  entityId?: string | null;
  payload?: unknown;
}) {
  try {
    await q(
      `insert into audit_log (actor, role, action, entity, entity_id, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.actor,
        input.role,
        input.action,
        input.entity ?? null,
        input.entityId ?? null,
        input.payload ? JSON.stringify(input.payload) : null,
      ],
    );
  } catch (error) {
    // Logging must never break the operation it describes.
    console.error("audit failed", error);
  }
}
