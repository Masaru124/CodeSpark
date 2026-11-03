#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *   BASE_URL=http://localhost:3000 node scripts/smoke.mjs
 * Uses .env.local for the admin password and the database for a judge code.
 */
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "./env.mjs";

loadEnv();

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);
let failures = 0;

function check(label, condition, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`${status}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function page(path, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: response.status, body: await response.text() };
}

async function login(payload) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  return { ok: response.ok, cookie, status: response.status };
}

// ---------------------------------------------------------------- health
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
check("health reports database up", health.ok === true, JSON.stringify(health));

// ---------------------------------------------------------- public pages
const home = await page("/");
check("landing page renders", home.status === 200 && home.body.includes("Code Spark Ops"));
const resultsClosed = await page("/results");
check(
  "results locked before publish",
  resultsClosed.status === 200 && resultsClosed.body.includes("not announced"),
);

// ------------------------------------------------------------ auth guards
const adminArea = await page("/admin");
check("anonymous /admin redirects to login", adminArea.status === 307, `status ${adminArea.status}`);
const unauthScan = await fetch(`${BASE}/api/scan`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "checkin", items: [{ token: "x" }] }),
});
check("anonymous scan is rejected", unauthScan.status === 401);

const badLogin = await login({ mode: "admin", email: "nobody@example.com", password: "wrong" });
check("wrong admin password rejected", badLogin.status === 401);

// ------------------------------------------------------------- admin login
const admin = await login({
  mode: "admin",
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
check("admin login works", admin.ok, `status ${admin.status}`);

for (const path of [
  "/admin",
  "/admin/teams",
  "/admin/import",
  "/admin/staff",
  "/admin/judging",
  "/admin/results",
  "/admin/audit",
]) {
  const result = await page(path, admin.cookie);
  check(`admin page ${path}`, result.status === 200, `status ${result.status}`);
}

// --------------------------------------------------------------- scanning
const rosterResponse = await fetch(`${BASE}/api/scan/roster`, { headers: { cookie: admin.cookie } });
const roster = await rosterResponse.json();
check("roster loads", rosterResponse.ok && roster.participants.length > 0, `${roster.participants?.length} passes`);

const unvisited = roster.participants.find((person) => !person.checkedInAt);
const token = (unvisited ?? roster.participants[0]).token;
// Use a participant with no lunch recorded yet so the first-serve assertion stays repeatable.
// /api/scan/roster caches for 30 s, so a stale list can still name someone who just ate:
// try a few candidates rather than trusting the first one.
const lunchCandidates = roster.participants
  .filter((person) => !(person.meals ?? []).includes("lunch"))
  .slice(0, 5);
const scan = (mode, tokenValue) =>
  fetch(`${BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin.cookie },
    body: JSON.stringify({ mode, items: [{ token: tokenValue }] }),
  }).then((r) => r.json());

if (unvisited) {
  const firstCheckin = await scan("checkin", token);
  const secondCheckin = await scan("checkin", token);
  check("first check-in accepted", firstCheckin.items?.[0]?.status === "ok", JSON.stringify(firstCheckin.items?.[0]));
  check("second check-in is a duplicate", secondCheckin.items?.[0]?.status === "duplicate");
} else {
  const repeat = await scan("checkin", token);
  check("already-checked-in participant is a duplicate", repeat.items?.[0]?.status === "duplicate");
}

let servedLunchToken = null;
let duplicateItem = null;
for (const candidate of lunchCandidates) {
  const item = (await scan("lunch", candidate.token)).items?.[0];
  if (item?.status === "ok") {
    servedLunchToken = candidate.token;
    break;
  }
  duplicateItem ??= item;
}

if (servedLunchToken) {
  check("first lunch served", true);
  duplicateItem = (await scan("lunch", servedLunchToken)).items?.[0];
} else {
  console.log("SKIP  first lunch served — no participant was still unserved for lunch");
}
check("second lunch rejected as duplicate", duplicateItem?.status === "duplicate", JSON.stringify(duplicateItem));
check(
  "duplicate message names the original time",
  /Already served lunch/.test(duplicateItem?.message ?? ""),
  duplicateItem?.message,
);

const forged = await scan("checkin", `${"a".repeat(32)}.${"b".repeat(22)}`);
check("forged token rejected", forged.items?.[0]?.status === "invalid");

const passPage = await page(`/pass/${token}`);
check(
  "participant pass page renders with QR",
  passPage.status === 200 && passPage.body.includes("Participant pass"),
);
const badPass = await page(`/pass/${"a".repeat(32)}.${"b".repeat(22)}`);
check("invalid pass shows a friendly error", badPass.body.includes("not valid"));

// ----------------------------------------------------------------- judging
// Pick the judge with the most unscored assignments so the scoring path is exercised on repeat runs.
const judge = await sql.query(
  `select j.id, j.name, j.invite_code from judges j
    where j.active = true
      and exists (select 1 from assignments a where a.judge_id = j.id)
    order by (
      select count(*) from assignments a
        left join scores s on s.assignment_id = a.id
       where a.judge_id = j.id and s.id is null
    ) desc, j.name
    limit 1`,
);
const judgeSession = await login({ mode: "judge", code: judge[0].invite_code });
check("judge code login works", judgeSession.ok);

const judgeHome = await page("/judge", judgeSession.cookie);
check("judge team list renders", judgeHome.status === 200 && judgeHome.body.includes("My teams"));

const assignment = await sql.query(
  `select a.id, a.team_id from assignments a
    where a.judge_id = $1
      and not exists (select 1 from scores s where s.assignment_id = a.id)
    limit 1`,
  [judge[0].id],
);

if (assignment.length > 0) {
  const assignmentId = assignment[0].id;
  const scoreResponse = await fetch(`${BASE}/api/judge/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: judgeSession.cookie },
    body: JSON.stringify({
      items: [
        {
          assignmentId,
          comment: "smoke test",
          entries: [
            { key: "demo", score: 8 },
            { key: "depth", score: 7.5 },
            { key: "impact", score: 9 },
            { key: "clarity", score: 6 },
          ],
        },
      ],
    }),
  });
  check("judge score batch saves", scoreResponse.status === 200, `status ${scoreResponse.status}`);

  const foreign = await sql.query(`select id from assignments where judge_id <> $1 limit 1`, [judge[0].id]);
  if (foreign.length > 0) {
    const forbidden = await fetch(`${BASE}/api/judge/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: judgeSession.cookie },
      body: JSON.stringify({ items: [{ assignmentId: foreign[0].id, entries: [{ key: "demo", score: 5 }] }] }),
    });
    check("judge cannot score another judge's assignment", forbidden.status === 403, `status ${forbidden.status}`);
  }
} else {
  console.log("SKIP  judge scoring — no untouched assignment for this judge");
}

// ------------------------------------------------------------- score pages
const scoredTeam = await sql.query(`select id from teams order by name limit 1`);
const teamPage = await page(`/admin/teams/${scoredTeam[0].id}`, admin.cookie);
check(
  "team pass sheet renders QR + links",
  teamPage.status === 200 && teamPage.body.includes("/pass/") && teamPage.body.includes("CODE SPARK 2026"),
  `status ${teamPage.status}`,
);

// ----------------------------------------------------------------- exports
const csv = await fetch(`${BASE}/api/admin/export?type=rankings`, { headers: { cookie: admin.cookie } });
const csvBody = await csv.text();
check(
  "rankings CSV exports",
  csv.status === 200 && (csv.headers.get("content-type") ?? "").startsWith("text/csv"),
  `${csvBody.split("\n").length} lines (empty until results are published)`,
);

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
