import { one } from "@/lib/db";
import { createTtlCache } from "@/lib/cache";

/**
 * One global revision, bumped by database triggers on every write to teams,
 * participants, scores, scans, submissions and staff. Every page polls this
 * cheap single-row read and re-renders its server components only when it
 * changes, so nothing has to be refreshed by hand.
 */
const cache = createTtlCache<number>(1_500, 2);

export async function liveRevision(): Promise<number> {
  return cache.get("rev", async () => {
    try {
      const row = await one<{ revision: string | number }>(
        `select revision from live_state where id = 1`,
      );
      return Number(row?.revision ?? 0);
    } catch {
      // Migration not applied yet — degrade to "never changes" rather than 500.
      return 0;
    }
  });
}
