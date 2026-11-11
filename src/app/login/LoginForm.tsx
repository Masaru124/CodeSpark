"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/redirect";

type Mode = "admin" | "judge" | "volunteer";

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "admin", label: "Admin", hint: "Email + password from the tech lead" },
  { id: "judge", label: "Judge", hint: "6-character judge code" },
  { id: "volunteer", label: "Volunteer", hint: "6-character volunteer code" },
];

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = MODES.find((item) => item.id === mode)!;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "admin"
            ? { mode, email, password }
            : { mode, code: code.trim().toUpperCase() },
        ),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) {
        setError(data.error || "Sign-in failed");
        setBusy(false);
        return;
      }
      router.replace(safeNextPath(next) ?? data.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Network error — check the connection and try again");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-100 p-1">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setMode(item.id);
              setError(null);
            }}
            className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
              mode === item.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-500">{active.hint}</p>

      {mode === "admin" ? (
        <>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className="input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="code" className="label">
            {active.label} code
          </label>
          <input
            id="code"
            required
            className="input font-mono text-lg uppercase tracking-[0.3em]"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={8}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoComplete="off"
          />
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
