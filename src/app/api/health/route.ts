import { json } from "@/lib/api";
import { dbConfigured, one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  if (!dbConfigured()) {
    return json({ ok: false, db: "not_configured" }, 503);
  }
  try {
    await one(`select 1 as ok`);
    return json({
      ok: true,
      db: "up",
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("health check failed", error);
    return json({ ok: false, db: "down", latencyMs: Date.now() - started }, 503);
  }
}
