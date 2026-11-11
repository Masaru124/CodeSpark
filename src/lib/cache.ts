/**
 * Tiny per-isolate TTL cache with request coalescing.
 *
 * The important part is `inflight`: when a cached value expires, hundreds of
 * concurrent requests must not each fire their own database query. The first one
 * loads, everyone else awaits the same promise. That stampede is what turns a
 * 5 s TTL into a burst of identical queries at a check-in desk.
 */
export type TtlCache<T> = {
  get(key: string, load: () => Promise<T>): Promise<T>;
  delete(key: string): void;
  clear(): void;
};

export function createTtlCache<T>(ttlMs: number, maxEntries = 500): TtlCache<T> {
  const values = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    async get(key, load) {
      const hit = values.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = load()
        .then((value) => {
          if (values.size >= maxEntries) values.clear();
          values.set(key, { at: Date.now(), value });
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });

      inflight.set(key, promise);
      return promise;
    },
    delete(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
      inflight.clear();
    },
  };
}
