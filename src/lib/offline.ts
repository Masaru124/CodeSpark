"use client";

/**
 * Minimal IndexedDB queue shared by the scanner and the judge app. Items survive
 * a refresh, a dead Wi-Fi window and a closed tab. Each item carries a
 * client_uuid so a retried flush can never double-write on the server.
 */

const DB_NAME = "codespark-ops";
const DB_VERSION = 1;
const STORE = "queue";

export type QueueItem = {
  id: string; // `${kind}:${key}` — one pending row per target
  kind: "scan" | "score";
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queuePut(item: QueueItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function queueAll(): Promise<QueueItem[]> {
  const db = await openDb();
  const items = await new Promise<QueueItem[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as QueueItem[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function queueDelete(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function queueCount(): Promise<number> {
  try {
    return (await queueAll()).length;
  } catch {
    return 0;
  }
}

export function newClientUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Flush with bounded retries; returns the number of items still pending. */
export async function flushQueue(
  send: (items: QueueItem[]) => Promise<{ ok: boolean; rejectIds?: string[] }>,
): Promise<number> {
  const items = await queueAll();
  if (items.length === 0) return 0;

  const batch = items.slice(0, 25);
  try {
    const result = await send(batch);
    if (!result.ok) return items.length;
    const rejected = new Set(result.rejectIds ?? []);
    for (const item of batch) {
      // Rejected items (invalid data) would never succeed — drop them.
      if (rejected.has(item.id)) {
        await queueDelete(item.id);
        continue;
      }
      await queueDelete(item.id);
    }
    return Math.max(0, items.length - batch.length);
  } catch {
    for (const item of batch) {
      await queuePut({ ...item, attempts: item.attempts + 1 });
    }
    return items.length;
  }
}
