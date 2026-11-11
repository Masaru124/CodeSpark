#!/usr/bin/env node
/**
 * Read-only latency probe for the event-day hot pages. It never writes:
 * no check-ins, scans, scores or teams are created.
 *
 *   BASE_URL=http://localhost:3100 REQUESTS=400 CONCURRENCY=100 node scripts/bench-reads.mjs
 */
import { loadEnv } from "./env.mjs";

loadEnv();

const BASE = process.env.BASE_URL || "http://localhost:3100";
const CONCURRENCY = Number(process.env.CONCURRENCY || 100);
const REQUESTS = Number(process.env.REQUESTS || 400);

const pct = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

async function scenario(label, build, total = REQUESTS) {
  const durations = [];
  const statuses = new Map();
  const startedAll = performance.now();

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
          await response.text();
          durations.push(performance.now() - started);
          statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        } catch {
          durations.push(performance.now() - started);
          statuses.set("network", (statuses.get("network") ?? 0) + 1);
        }
      }
    }),
  );

  const wall = performance.now() - startedAll;
  console.log(
    `${label.padEnd(24)} p50 ${pct(durations, 50).toFixed(0).padStart(4)}ms  ` +
      `p95 ${pct(durations, 95).toFixed(0).padStart(4)}ms  ` +
      `p99 ${pct(durations, 99).toFixed(0).padStart(4)}ms  ` +
      `${(durations.length / (wall / 1000)).toFixed(0).padStart(4)} rps  ` +
      JSON.stringify(Object.fromEntries(statuses)),
  );
}

async function login(body) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

const adminCookie = await login({
  mode: "admin",
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
if (!adminCookie) {
  console.error("admin login failed");
  process.exit(1);
}

const rosterResponse = await fetch(`${BASE}/api/scan/roster`, { headers: { cookie: adminCookie } });
const roster = await rosterResponse.json();
const tokens = (roster.teams ?? []).map((team) => team.token);
if (tokens.length === 0) {
  console.error("roster empty");
  process.exit(1);
}

console.log(`\n${REQUESTS} reads per scenario · ${CONCURRENCY} in flight · ${BASE} · ${tokens.length} team passes\n`);

await scenario("health (db)", () => ({ url: `${BASE}/api/health` }));
await scenario("home (ssr)", () => ({ url: `${BASE}/` }));
await scenario("results (ssr)", () => ({ url: `${BASE}/results` }));
await scenario("pass page (ssr)", (index) => ({ url: `${BASE}/pass/${tokens[index % tokens.length]}` }));
await scenario("roster api", () => ({ url: `${BASE}/api/scan/roster`, init: { headers: { cookie: adminCookie } } }));
await scenario("admin overview", () => ({ url: `${BASE}/admin`, init: { headers: { cookie: adminCookie } } }));
