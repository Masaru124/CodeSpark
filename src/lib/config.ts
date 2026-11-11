import { one, q } from "@/lib/db";
import { createTtlCache } from "@/lib/cache";

export type EventInfo = {
  name: string;
  venue: string;
  starts_at: string;
  hack_start: string;
  submission_deadline: string;
  results_at: string;
};

export type JudgingConfig = {
  finalists: number;
  screening_weight: number;
  final_weight: number;
  outlier_threshold: number;
};

export type PublishConfig = { published: boolean; published_at: string | null };

export type PlatformConfig = {
  event: EventInfo;
  judging: JudgingConfig;
  publish: PublishConfig;
};

const FALLBACK: PlatformConfig = {
  event: {
    name: "CODE SPARK 2026",
    venue: "AMC Engineering College, Bengaluru",
    starts_at: "2026-11-12T08:30:00+05:30",
    hack_start: "2026-11-12T09:40:00+05:30",
    submission_deadline: "2026-11-12T17:30:00+05:30",
    results_at: "2026-11-12T20:50:00+05:30",
  },
  judging: { finalists: 10, screening_weight: 0.3, final_weight: 0.7, outlier_threshold: 2 },
  publish: { published: false, published_at: null },
};

// Short TTL per isolate with request coalescing. Keeps the hot read path off
// the database under load, while a publish toggle still lands within seconds.
const CONFIG_TTL_MS = 5_000;
const cache = createTtlCache<PlatformConfig>(CONFIG_TTL_MS, 8);

export async function getConfig(force = false): Promise<PlatformConfig> {
  if (force) cache.delete("config");
  return cache.get("config", async () => {
    const rows = await q<{ key: string; value: unknown }>(
      `select key, value from event_config where key in ('event','judging','publish')`,
    );
    const merged: PlatformConfig = {
      event: { ...FALLBACK.event },
      judging: { ...FALLBACK.judging },
      publish: { ...FALLBACK.publish },
    };
    for (const row of rows) {
      if (row.key === "event") merged.event = { ...FALLBACK.event, ...(row.value as EventInfo) };
      if (row.key === "judging") merged.judging = { ...FALLBACK.judging, ...(row.value as JudgingConfig) };
      if (row.key === "publish") merged.publish = { ...FALLBACK.publish, ...(row.value as PublishConfig) };
    }
    return merged;
  });
}

export async function setConfig(key: keyof PlatformConfig, value: unknown) {
  await one(
    `insert into event_config (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  cache.delete("config");
}
