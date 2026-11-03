#!/usr/bin/env node
/**
 * Concurrency check for the read path and the scan write path.
 *
 *   BASE_URL=https://your-host CONCURRENCY=500 ROUNDS=2 node scripts/loadtest.mjs
 *
 * Phase 1 hits /api/health, which performs a real database round trip.
 * Phase 2 logs in as every active volunteer (up to 8) and fires scans spread
 * across those sessions, which measures the HMAC verify + lookup + upsert path
 * without the per-staff rate limiter dominating the result.
 */
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./env.mjs";

loadEnv();

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CONCURRENCY = Number(process.env.CONCURRENCY || 500);
const ROUNDS = Number(process.env.ROUNDS || 2);
const MAX_SESSIONS = 8;

const percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/**
 * @param {string} label
 * @param {(index: number) => { url: string, init?: RequestInit }} build
 * @param {number} total
 */
async function phase(label, build, total) {
  const durations = [];
  const statuses = new Map();
  let failures = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, worker) => {
      const rounds = Math.ceil(total / CONCURRENCY);
      for (let round = 0; round < rounds; round += 1) {
        const index = worker + round * CONCURRENCY;
        if (index >= total) return;
        const { url, init } = build(index);
        const started = performance.now();
        try {
          const response = await fetch(url, init);
          durations.push(performance.now() - started);
          statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
          await response.text();
          if (response.status >= 500) failures += 1;
        } catch {
          durations.push(performance.now() - started);
          statuses.set("network", (statuses.get("network") ?? 0) + 1);
          failures += 1;
        }
      }
    }),
  );

  const slowest = durations.length > 0 ? Math.max(...durations) : 0;
  console.log(
    `${label}: ${durations.length} requests · ` +
      `p50 ${percentile(durations, 50).toFixed(0)}ms · ` +
      `p95 ${percentile(durations, 95).toFixed(0)}ms · ` +
      `p99 ${percentile(durations, 99).toFixed(0)}ms · ` +
      `max ${slowest.toFixed(0)}ms · ` +
      `5xx/network ${failures} · statuses ${JSON.stringify(Object.fromEntries(statuses))}`,
  );
  return failures;
}

const healthFailures = await phase(
  "health (DB round trip)",
  () => ({ url: `${BASE_URL}/api/health` }),
  CONCURRENCY * ROUNDS,
);

// ---------------------------------------------------------------- scan phase
const connection = process.env.DATABASE_URL;
if (!connection) {
  console.log("DATABASE_URL missing — skipping the scan phase.");
  process.exit(healthFailures > 0 ? 1 : 0);
}

const sql = neon(connection);
const codes = await sql.query(
  `select code from volunteers where active = true order by created_at limit ${MAX_SESSIONS}`,
);

const sessions = [];
for (const row of codes) {
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "volunteer", code: row.code }),
  });
  if (!login.ok) continue;
  sessions.push(
    (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; "),
  );
}
if (sessions.length === 0) {
  console.log("No volunteer session available — skipping the scan phase.");
  process.exit(healthFailures > 0 ? 1 : 0);
}

const rosterResponse = await fetch(`${BASE_URL}/api/scan/roster`, {
  headers: { cookie: sessions[0] },
});
const roster = await rosterResponse.json();
const tokens = (roster.participants ?? []).map((row) => row.token);
if (tokens.length === 0) {
  console.log("Roster is empty — import teams first.");
  process.exit(1);
}

console.log(`scan phase using ${sessions.length} volunteer session(s), ${tokens.length} passes`);

const scanFailures = await phase(
  "scan (HMAC + lookup + write)",
  (index) => ({
    url: `${BASE_URL}/api/scan`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: sessions[index % sessions.length] },
      body: JSON.stringify({
        mode: "checkin",
        items: [{ token: tokens[index % tokens.length], clientUuid: null }],
      }),
    },
  }),
  CONCURRENCY * ROUNDS,
);

process.exit(healthFailures + scanFailures > 0 ? 1 : 0);
