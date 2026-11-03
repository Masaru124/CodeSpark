"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushQueue, newClientUuid, queueAll, queuePut } from "@/lib/offline";

type Criterion = { key: string; label: string; weight: number; max_score: number };

export default function ScoreForm({
  assignmentId,
  criteria,
  initial,
  initialComment,
  teamName,
}: {
  assignmentId: string;
  criteria: Criterion[];
  initial: Record<string, number>;
  initialComment: string;
  teamName: string;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const start: Record<string, number> = {};
    for (const criterion of criteria) {
      start[criterion.key] = initial[criterion.key] ?? Math.round(criterion.max_score / 2);
    }
    return start;
  });
  const [comment, setComment] = useState(initialComment);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    queueAll()
      .then((items) => setPending(items.length))
      .catch(() => setPending(0));
    const interval = window.setInterval(() => {
      queueAll()
        .then((items) => setPending(items.filter((item) => item.kind === "score").length))
        .catch(() => undefined);
    }, 15_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = useMemo(
    () =>
      criteria.reduce(
        (sum, criterion) => sum + ((values[criterion.key] ?? 0) / criterion.max_score) * criterion.weight,
        0,
      ),
    [criteria, values],
  );

  const flush = useCallback(async () => {
    setSyncing(true);
    setError(null);
    let remaining = 1;
    for (let attempt = 0; attempt < 4 && remaining > 0; attempt += 1) {
      remaining = await flushQueue(async (items) => {
        try {
          const response = await fetch("/api/judge/scores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: items.map((item) => item.payload) }),
          });
          if (response.status === 401) {
            setError("Session expired — sign in again. Your scores stay queued on this device.");
            return { ok: false };
          }
          return { ok: response.ok };
        } catch {
          return { ok: false };
        }
      });
      setPending(remaining);
    }
    setSyncing(false);
    if (remaining === 0) setSavedAt(Date.now());
  }, []);

  async function save() {
    const payload = {
      assignmentId,
      comment,
      entries: criteria.map((criterion) => ({
        key: criterion.key,
        score: values[criterion.key] ?? 0,
      })),
      clientUuid: newClientUuid(),
    };

    try {
      await queuePut({
        id: `score:${assignmentId}`,
        kind: "score",
        payload,
        createdAt: Date.now(),
        attempts: 0,
      });
      setPending(await queueAll().then((items) => items.length));
    } catch {
      // IndexedDB can be unavailable in private mode — still try the network.
      setPending(1);
    }
    await flush();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink-900">{teamName}</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={online ? "badge-ok" : "badge-warn"}>
            {online ? "Online" : "Offline — queued locally"}
          </span>
          {pending > 0 ? (
            <span className="badge-warn">{pending} pending</span>
          ) : savedAt ? (
            <span className="badge-ok">Saved</span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {criteria.map((criterion) => (
          <div key={criterion.key} className="card-pad">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`score-${criterion.key}`} className="text-sm font-semibold text-ink-900">
                {criterion.label}
                <span className="ml-2 text-xs font-normal text-ink-500">{criterion.weight}%</span>
              </label>
              <span className="font-mono text-lg font-bold tabular-nums text-spark-700">
                {(values[criterion.key] ?? 0).toFixed(1)}
                <span className="text-xs font-normal text-ink-400"> / {criterion.max_score}</span>
              </span>
            </div>
            <input
              id={`score-${criterion.key}`}
              type="range"
              min={0}
              max={criterion.max_score}
              step={0.5}
              value={values[criterion.key] ?? 0}
              onChange={(event) =>
                setValues((current) => ({ ...current, [criterion.key]: Number(event.target.value) }))
              }
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-spark-600"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
              <span>0</span>
              <span>{criterion.max_score / 2}</span>
              <span>{criterion.max_score}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card-pad">
        <label htmlFor="comment" className="label">
          Notes for the deliberation (optional)
        </label>
        <textarea
          id="comment"
          rows={3}
          className="input"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Strong demo, weak deployment story…"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-600">
            Weighted total{" "}
            <strong className="font-mono text-ink-900">{total.toFixed(2)} / 100</strong>
          </p>
          <button type="button" onClick={save} disabled={syncing} className="btn-primary">
            {syncing ? "Saving…" : "Save score sheet"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Saving writes to this device first, then syncs. If the page is closed before syncing, reopen
          it and the queue flushes automatically.
        </p>
      </div>
    </div>
  );
}
