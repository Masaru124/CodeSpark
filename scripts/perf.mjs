#!/usr/bin/env node
/**
 * Performance probe: what happens when 500 people hit the app at once.
 *
 *   node scripts/perf.mjs                       # 500 concurrent users, one request each
 *   REQUESTS=1000 CONCURRENCY=500 node scripts/perf.mjs
 *   WRITE_BASE_URL=http://localhost:3001 node scripts/perf.mjs   # raised rate limits
 *
 * Read paths run against BASE_URL, write paths against WRITE_BASE_URL (same app,
 * usually a second port started with the scan/score limits raised so the
 * per-staff limiter is not what the numbers measure).
 */
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./env.mjs";

loadEnv();

const BASE = process.env.BASE_URL || "http://localhost:3000";
const WRITE_BASE = process.env.WRITE_BASE_URL || BASE;
const CONCURRENCY = Number(process.env.CONCURRENCY || 500);
const REQUESTS = Number(process.env.REQUESTS || 500);

const pct = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const rows = [];
let totalFailures = 0;

async function scenario(label, build, total = REQUESTS) {
  const durations = [];
  const statuses = new Map();
  let bytes = 0;
  let failures = 0;
  const startAll = performance.now();

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
          const body = await response.text();
          bytes += body.length;
          durations.push(performance.now() - started);
          statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
          if (response.status >= 500) failures += 1;
        } catch {
          durations.push(performance.now() - started);
          statuses.set("network", (statuses.get("network") ?? 0) + 1);
          failures += 1;
        }
      }
    }),
  );

  const wall = performance.now() - startAll;
  const result = {
    label,
    n: durations.length,
    rps: durations.length / (wall / 1000),
    p50: pct(durations, 50),
    p95: pct(durations, 95),
    p99: pct(durations, 99),
    max: durations.length ? Math.max(...durations) : 0,
    avgKB: durations.length ? bytes / durations.length / 1024 : 0,
    failures,
    statuses: Object.fromEntries(statuses),
  };
  rows.push(result);
  totalFailures += failures;
  console.log(
    `${label.padEnd(26)} n=${String(result.n).padStart(4)} ` +
      `p50 ${result.p50.toFixed(0).padStart(4)}ms  p95 ${result.p95.toFixed(0).padStart(5)}ms  ` +
      `p99 ${result.p99.toFixed(0).padStart(5)}ms  max ${result.max.toFixed(0).padStart(5)}ms  ` +
      `${result.rps.toFixed(0).padStart(4)} rps  ${result.avgKB.toFixed(0).padStart(4)}kB  ` +
      `5xx/net ${failures}  ${JSON.stringify(result.statuses)}`,
  );
  return result;
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
  console.error("admin login failed — cannot measure the console");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const volunteerCodes = await sql.query(
  `select code from volunteers where active = true order by created_at limit 8`,
);
const volunteerCookies = [];
for (const row of volunteerCodes) {
  const cookie = await login({ mode: "volunteer", code: row.code });
  if (cookie) volunteerCookies.push(cookie);
}

const rosterResponse = await fetch(`${BASE}/api/scan/roster`, { headers: { cookie: adminCookie } });
const roster = await rosterResponse.json();
const tokens = (roster.participants ?? []).map((row) => row.token);
if (tokens.length === 0) {
  console.error("roster empty — run npm run db:demo first");
  process.exit(1);
}

const judge = await sql.query(
  `select j.invite_code, a.id as assignment_id
     from judges j join assignments a on a.judge_id = j.id
    where j.active = true
    order by j.name limit 1`,
);
const judgeCookie = judge[0] ? await login({ mode: "judge", code: judge[0].invite_code }) : null;
const assignmentId = judge[0]?.assignment_id ?? null;

// Seed one score so the upsert path has a row to update.
if (judgeCookie && assignmentId) {
  await fetch(`${WRITE_BASE}/api/judge/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: judgeCookie },
    body: JSON.stringify({
      items: [
        {
          assignmentId,
          comment: "perf",
          entries: [
            { key: "demo", score: 7 },
            { key: "depth", score: 7 },
            { key: "impact", score: 7 },
            { key: "clarity", score: 7 },
          ],
        },
      ],
    }),
  });
}

console.log(`\n${REQUESTS} requests per scenario · ${CONCURRENCY} in flight · reads ${BASE} · writes ${WRITE_BASE}\n`);

await scenario("health (db query)", () => ({ url: `${BASE}/api/health` }));
await scenario("home page (ssr)", () => ({ url: `${BASE}/` }));
await scenario("results page (ssr)", () => ({ url: `${BASE}/results` }));
await scenario("pass page (ssr)", (index) => ({ url: `${BASE}/pass/${tokens[index % tokens.length]}` }));
await scenario("admin overview (ssr)", () => ({ url: `${BASE}/admin`, init: { headers: { cookie: adminCookie } } }));
await scenario("roster api (cached)", () => ({
  url: `${BASE}/api/scan/roster`,
  init: { headers: { cookie: volunteerCookies[0] ?? adminCookie } },
}));
await scenario("scan write (hmac+upsert)", (index) => ({
  url: `${WRITE_BASE}/api/scan`,
  init: {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: volunteerCookies[index % Math.max(volunteerCookies.length, 1)] ?? adminCookie,
    },
    body: JSON.stringify({
      mode: "snacks",
      items: [{ token: tokens[index % tokens.length], clientUuid: null }],
    }),
  },
}));

if (judgeCookie && assignmentId) {
  await scenario("score write (upsert)", (index) => ({
    url: `${WRITE_BASE}/api/judge/scores`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: judgeCookie },
      body: JSON.stringify({
        items: [
          {
            assignmentId,
            comment: `perf ${index}`,
            entries: [
              { key: "demo", score: 6 + (index % 4) },
              { key: "depth", score: 6 + (index % 3) },
              { key: "impact", score: 6 + (index % 3) },
              { key: "clarity", score: 6 + (index % 4) },
            ],
          },
        ],
      }),
    },
  }));
}

// The realistic burst: mostly scans, some roster refreshes, some browsing.
await scenario("mixed event burst", (index) => {
  const bucket = index % 10;
  if (bucket < 6) {
    return {
      url: `${WRITE_BASE}/api/scan`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: volunteerCookies[index % Math.max(volunteerCookies.length, 1)] ?? adminCookie,
        },
        body: JSON.stringify({
          mode: "dinner",
          items: [{ token: tokens[(index * 7) % tokens.length], clientUuid: null }],
        }),
      },
    };
  }
  if (bucket < 8) {
    return { url: `${BASE}/api/scan/roster`, init: { headers: { cookie: volunteerCookies[0] ?? adminCookie } } };
  }
  if (bucket === 8) return { url: `${BASE}/results` };
  return { url: `${BASE}/pass/${tokens[(index * 3) % tokens.length]}` };
}, REQUESTS * 2);

const worstP95 = Math.max(...rows.map((row) => row.p95));
console.log(
  `\nworst p95 ${worstP95.toFixed(0)}ms · total 5xx/network ${totalFailures} · ` +
    `${rows.reduce((sum, row) => sum + row.n, 0)} requests served`,
);
process.exit(totalFailures > 0 ? 1 : 0);
