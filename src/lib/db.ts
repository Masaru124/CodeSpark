import { neon } from "@neondatabase/serverless";

type NeonClient = ReturnType<typeof neon>;

let cached: NeonClient | null = null;
let cachedUrl: string | null = null;

/**
 * Neon's serverless driver is stateless over HTTP(S), so no connection is held
 * between requests. Point it at the **pooled** endpoint anyway: that is the host
 * Neon sizes for hundreds of concurrent functions, and it avoids opening a new
 * Postgres session per burst.
 *
 * A direct `ep-...` host is rewritten to `ep-...-pooler...` unless
 * NEON_POOLER=off. `channel_binding` is a libpq parameter with no meaning here.
 */
export function connectionUrl(raw: string | undefined = process.env.DATABASE_URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
    if (
      process.env.NEON_POOLER !== "off" &&
      /\.neon\.tech$/i.test(url.hostname) &&
      !url.hostname.includes("-pooler")
    ) {
      url.hostname = url.hostname.replace(/^(ep-[a-z0-9-]+)\./i, "$1-pooler.");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function client(): NeonClient {
  const url = connectionUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not configured. See .env.example.");
  }
  if (!cached || cachedUrl !== url) {
    cached = neon(url, { fetchOptions: { cache: "no-store" } });
    cachedUrl = url;
  }
  return cached;
}

// Transport-level failures under a burst are worth one more attempt; SQL errors
// are not. Every write in this app is an upsert or an `on conflict do nothing`,
// so a retried statement cannot double-count a scan or a score.
const RETRYABLE =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|Connect Timeout|UND_ERR/i;

function isRetryable(error: unknown): boolean {
  if (!error) return false;
  const message = `${(error as { message?: string }).message ?? ""} ${
    (error as { sourceError?: { message?: string } }).sourceError?.message ?? ""
  }`;
  return RETRYABLE.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parameterised query. Never interpolate user input into SQL. */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = client();
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return (await sql.query(text, params)) as T[];
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) throw error;
      await sleep(30 * 2 ** attempt + Math.random() * 40);
    }
  }
  throw lastError;
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
