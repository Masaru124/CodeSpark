import { createTtlCache } from "./cache";

/**
 * Shared so the team pass page (read) and the self check-in action (write) use
 * the same cache: checking in clears it, and the refreshed page shows the lead
 * as present immediately instead of up to 5 s later.
 */
export const passCache = createTtlCache<unknown>(5_000, 500);
