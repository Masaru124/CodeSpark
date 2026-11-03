"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { newClientUuid, queueAll, queueDelete, queuePut } from "@/lib/offline";

type Mode = "checkin" | "lunch" | "snacks" | "dinner";

type RosterEntry = {
  token: string;
  name: string;
  team: string;
  checkedInAt: string | null;
  meals: string[];
};

type Feedback = {
  kind: "idle" | "ok" | "warn" | "bad" | "queued";
  title: string;
  detail?: string;
  at?: number;
};

type HistoryEntry = { name: string; team: string; mode: Mode; status: string; time: string };

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "checkin", label: "Check-in" },
  { id: "lunch", label: "Lunch" },
  { id: "snacks", label: "Snacks" },
  { id: "dinner", label: "Dinner" },
];

const ROSTER_KEY = "codespark-roster-v1";

export default function Scanner({
  volunteer,
  eventName,
  deadline,
}: {
  volunteer: string;
  eventName: string;
  deadline: string;
}) {
  const [mode, setMode] = useState<Mode>("checkin");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle", title: "Ready to scan" });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [rosterInfo, setRosterInfo] = useState<{ count: number; at: string | null }>({
    count: 0,
    at: null,
  });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState(true);

  const rosterRef = useRef<Map<string, RosterEntry>>(new Map());
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastScanRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });
  const busyRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      const items = await queueAll();
      setPending(items.filter((item) => item.kind === "scan").length);
    } catch {
      setPending(0);
    }
  }, []);

  const saveRoster = useCallback((entries: RosterEntry[], at: string) => {
    const map = new Map(entries.map((entry) => [entry.token, entry]));
    rosterRef.current = map;
    setRosterInfo({ count: entries.length, at });
    try {
      localStorage.setItem(ROSTER_KEY, JSON.stringify({ at, entries }));
    } catch {
      // Storage full or unavailable — the network path still works.
    }
  }, []);

  const loadCachedRoster = useCallback(() => {
    try {
      const raw = localStorage.getItem(ROSTER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at: string; entries: RosterEntry[] };
      if (Array.isArray(parsed.entries)) saveRoster(parsed.entries, parsed.at);
    } catch {
      // ignore corrupt cache
    }
  }, [saveRoster]);

  const loadRoster = useCallback(async () => {
    try {
      const response = await fetch("/api/scan/roster", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        generatedAt: string;
        participants: RosterEntry[];
      };
      saveRoster(data.participants, data.generatedAt);
    } catch {
      // offline: keep the cached roster
    }
  }, [saveRoster]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((current) => [entry, ...current].slice(0, 12));
  }, []);

  const flush = useCallback(async () => {
    let items;
    try {
      items = (await queueAll()).filter((item) => item.kind === "scan");
    } catch {
      return;
    }
    if (items.length === 0) {
      setPending(0);
      return;
    }

    const byMode = new Map<Mode, typeof items>();
    for (const item of items) {
      const itemMode = (item.payload.mode as Mode) ?? "checkin";
      byMode.set(itemMode, [...(byMode.get(itemMode) ?? []), item]);
    }

    for (const [itemMode, group] of byMode) {
      const batch = group.slice(0, 25);
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: itemMode,
            items: batch.map((item) => ({
              token: item.payload.token,
              clientUuid: item.payload.clientUuid,
            })),
          }),
        });
        if (!response.ok) continue;
        for (const item of batch) await queueDelete(item.id);
      } catch {
        break;
      }
    }
    await refreshPending();
  }, [refreshPending]);

  const record = useCallback(
    async (rawToken: string) => {
      const token = rawToken.trim().replace(/^.*\//, "");
      if (!token || busyRef.current) return;

      const now = Date.now();
      if (lastScanRef.current.token === token && now - lastScanRef.current.at < 2500) return;
      lastScanRef.current = { token, at: now };
      busyRef.current = true;

      const entry = rosterRef.current.get(token);

      // Offline duplicate guard using the cached roster.
      if (entry) {
        if (mode === "checkin" && entry.checkedInAt) {
          setFeedback({
            kind: "warn",
            title: `${entry.name} already checked in`,
            detail: entry.team,
            at: now,
          });
          pushHistory({ name: entry.name, team: entry.team, mode, status: "already in", time: "now" });
          navigator.vibrate?.(40);
          busyRef.current = false;
          return;
        }
        if (mode !== "checkin" && entry.meals.includes(mode)) {
          setFeedback({
            kind: "warn",
            title: `${entry.name} already served ${mode}`,
            detail: entry.team,
            at: now,
          });
          pushHistory({ name: entry.name, team: entry.team, mode, status: `repeat ${mode}`, time: "now" });
          navigator.vibrate?.(40);
          busyRef.current = false;
          return;
        }
      }

      const clientUuid = newClientUuid();

      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, items: [{ token, clientUuid }] }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as {
          items: Array<{ status: string; name?: string; team?: string; message: string }>;
        };
        const item = data.items?.[0];
        if (!item) throw new Error("empty response");

        if (item.status === "ok") {
          setFeedback({
            kind: "ok",
            title: item.name ? `${item.name} ✓ ${mode === "checkin" ? "checked in" : mode}` : item.message,
            detail: item.team,
            at: now,
          });
          navigator.vibrate?.(60);
        } else if (item.status === "duplicate") {
          setFeedback({ kind: "warn", title: item.message, detail: item.team ?? item.name, at: now });
          navigator.vibrate?.([40, 60, 40]);
        } else {
          setFeedback({ kind: "bad", title: item.message, detail: "Ask for the printed list", at: now });
          navigator.vibrate?.(120);
        }

        // Keep the local roster truthful so the next scan is instant.
        const rosterEntry = rosterRef.current.get(token);
        if (rosterEntry && item.status === "ok") {
          if (mode === "checkin") rosterEntry.checkedInAt = new Date().toISOString();
          else rosterEntry.meals = [...rosterEntry.meals, mode];
        }
        pushHistory({
          name: item.name ?? "Unknown pass",
          team: item.team ?? "—",
          mode,
          status: item.message,
          time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
      } catch {
        await queuePut({
          id: `scan:${mode}:${token}`,
          kind: "scan",
          payload: { mode, token, clientUuid },
          createdAt: now,
          attempts: 0,
        });
        await refreshPending();
        setFeedback({
          kind: "queued",
          title: entry ? `${entry.name} queued offline` : "Queued offline",
          detail: entry ? `${entry.team} · syncs when back online` : "Syncs when back online",
          at: now,
        });
      } finally {
        busyRef.current = false;
      }
    },
    [mode, pushHistory, refreshPending],
  );

  // Boot: cached roster, fresh roster, pending scans, connectivity listeners.
  useEffect(() => {
    loadCachedRoster();
    void loadRoster();
    void refreshPending();
    setOnline(navigator.onLine);

    const goOnline = () => {
      setOnline(true);
      void flush();
      void loadRoster();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    const interval = window.setInterval(() => {
      void loadRoster();
      void flush();
    }, 60_000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(interval);
    };
  }, [flush, loadCachedRoster, loadRoster, refreshPending]);

  // Camera lifecycle.
  useEffect(() => {
    if (!cameraOn) {
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => undefined);
      }
      return;
    }

    let cancelled = false;
    setCameraError(null);

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const instance = new Html5Qrcode("scanner-viewport", { verbose: false });
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded) => {
            void record(decoded);
          },
          () => undefined,
        );
        if (cancelled) {
          await instance.stop().catch(() => undefined);
          instance.clear();
          return;
        }
        scannerRef.current = instance as unknown as { stop: () => Promise<void>; clear: () => void };
      } catch (error) {
        setCameraError(
          error instanceof Error && error.message
            ? `${error.message} — use manual entry below.`
            : "Camera unavailable — use manual entry below.",
        );
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => undefined);
      }
    };
  }, [cameraOn, record]);

  const closed = Date.now() > new Date(deadline).getTime();
  const matches = search.trim()
    ? [...rosterRef.current.values()]
        .filter((entry) =>
          `${entry.name} ${entry.team}`.toLowerCase().includes(search.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];

  const tone =
    feedback.kind === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : feedback.kind === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : feedback.kind === "bad"
          ? "border-red-300 bg-red-50 text-red-900"
          : feedback.kind === "queued"
            ? "border-sky-300 bg-sky-50 text-sky-900"
            : "border-ink-200 bg-white text-ink-700";

  return (
    <div className="min-h-screen bg-ink-50 pb-10">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold text-ink-900">⚡ {eventName} scanner</p>
            <p className="text-xs text-ink-500">
              {volunteer} ·{" "}
              <span className={online ? "text-emerald-600" : "text-amber-600"}>
                {online ? "online" : "offline"}
              </span>
              {pending > 0 ? ` · ${pending} queued` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void flush()} className="btn-ghost text-xs">
              Sync
            </button>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn-ghost text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-ink-200/60 p-1.5">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMode(item.id);
                setFeedback({ kind: "idle", title: `${item.label} mode`, detail: "Scan a pass" });
              }}
              className={`rounded-lg px-2 py-2.5 text-sm font-semibold transition ${
                mode === item.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {closed && mode !== "checkin" ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            The submission window has closed. Meal scanning is unaffected.
          </p>
        ) : null}

        <div className={`rounded-2xl border-2 p-5 transition ${tone}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">{feedback.title}</p>
              {feedback.detail ? <p className="mt-1 text-sm opacity-80">{feedback.detail}</p> : null}
            </div>
            <span className="text-2xl">
              {feedback.kind === "ok" ? "✅" : feedback.kind === "warn" ? "⚠️" : feedback.kind === "bad" ? "⛔" : feedback.kind === "queued" ? "📥" : "🎫"}
            </span>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="relative bg-ink-900">
            <div id="scanner-viewport" className="mx-auto aspect-square w-full max-w-sm [&_video]:w-full" />
            {!cameraOn ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-white/80">
                  Camera is off. Start it once, then the phone only needs taps.
                </p>
                <button type="button" className="btn-primary" onClick={() => setCameraOn(true)}>
                  Start camera
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-ink-500">
              {rosterInfo.count} passes cached
              {rosterInfo.at
                ? ` · updated ${new Date(rosterInfo.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`
                : ""}
            </p>
            {cameraOn ? (
              <button type="button" className="btn-ghost text-xs" onClick={() => setCameraOn(false)}>
                Stop camera
              </button>
            ) : null}
          </div>
          {cameraError ? (
            <p className="border-t border-ink-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {cameraError}
            </p>
          ) : null}
        </div>

        <form
          className="card-pad"
          onSubmit={(event) => {
            event.preventDefault();
            void record(manual);
            setManual("");
          }}
        >
          <label htmlFor="manual" className="label">
            Manual entry (QR unreadable)
          </label>
          <div className="flex gap-2">
            <input
              id="manual"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              className="input font-mono text-xs"
              placeholder="Paste the pass token or link"
            />
            <button type="submit" className="btn-secondary">
              Scan
            </button>
          </div>

          <div className="mt-3">
            <label htmlFor="search" className="label">
              Find a participant by name
            </label>
            <input
              id="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input"
              placeholder="Name or team"
            />
            {matches.length > 0 ? (
              <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200">
                {matches.map((entry) => (
                  <li key={entry.token} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-900">{entry.name}</span>
                      <span className="block truncate text-xs text-ink-500">{entry.team}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-primary shrink-0 text-xs"
                      onClick={() => {
                        void record(entry.token);
                        setSearch("");
                      }}
                    >
                      Scan
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </form>

        {history.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Mode</th>
                  <th>Result</th>
                  <th className="text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => (
                  <tr key={`${entry.name}-${index}`}>
                    <td>
                      <span className="font-medium text-ink-900">{entry.name}</span>
                      <span className="block text-xs text-ink-500">{entry.team}</span>
                    </td>
                    <td className="text-xs uppercase text-ink-500">{entry.mode}</td>
                    <td className="text-xs text-ink-600">{entry.status}</td>
                    <td className="text-right font-mono text-xs text-ink-500">{entry.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="text-center text-xs text-ink-500">
          Duplicate scans are blocked by the database, so a double tap can never serve twice.{" "}
          <Link href="/" className="link">
            Home
          </Link>
        </p>
      </div>
    </div>
  );
}
