#!/usr/bin/env node
/**
 * Code Spark Ops database tooling.
 *
 *   node scripts/db.mjs migrate   # apply db/schema.sql (idempotent)
 *   node scripts/db.mjs seed      # create/refresh the admin login from env
 *   node scripts/db.mjs demo      # load 60 fake teams + judges + scores
 *   node scripts/db.mjs reset     # DROP everything in the public schema
 *
 * Reads DATABASE_URL from the environment or from .env / .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";
import Papa from "papaparse";

const ROOT = resolve(import.meta.dirname, "..");

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local (see .env.example).");
  process.exit(1);
}

const sql = neon(url, { fetchOptions: { cache: "no-store" } });
const q = (text, params = []) => sql.query(text, params);

/** Split a SQL file into statements, respecting quotes and comments. */
function splitStatements(source) {
  const out = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += ch;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const PASSWORD_ITERATIONS = 120_000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function code(length = 6) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

async function migrate() {
  const source = readFileSync(resolve(ROOT, "db/schema.sql"), "utf8");
  const statements = splitStatements(source);
  for (const statement of statements) {
    await q(statement);
  }
  const tables = await q(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`,
  );
  console.log(`migrate: applied ${statements.length} statements`);
  console.log(`tables: ${tables.map((r) => r.table_name).join(", ")}`);
}

async function seed() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email) {
    throw new Error("ADMIN_EMAIL is required");
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must be at least 10 characters");
  }
  const hash = hashPassword(password);
  await q(
    `insert into admin_users (email, name, password_hash)
     values ($1, $2, $3)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [email, "Tech Lead", hash],
  );
  console.log(`seed: admin ${email} ready`);
  console.log("seed: log in at /login with ADMIN_EMAIL / ADMIN_PASSWORD");
}

const FIRST = ["Aarav", "Diya", "Ishaan", "Meera", "Rohan", "Sana", "Kabir", "Ananya", "Vihaan", "Tara", "Arjun", "Neha", "Dev", "Riya", "Aditya", "Kavya", "Nikhil", "Ira", "Yash", "Zoya", "Karthik", "Pooja", "Manav", "Shreya", "Rishi", "Anika", "Ved", "Nisha", "Om", "Lakshmi"];
const LAST = ["Sharma", "Nair", "Iyer", "Patel", "Reddy", "Gupta", "Menon", "Rao", "Bose", "Kulkarni", "Shetty", "Verma", "Joshi", "Pillai", "Desai"];
const COLLEGES = ["AMC Engineering College", "RV College of Engineering", "PES University", "BMS College of Engineering", "MSRIT", "Dayananda Sagar College"];
const TRACKS = ["AI/ML", "Web3", "HealthTech", "EdTech", "Sustainability", "Open Innovation"];
const PROJECTS = ["CampusRide", "MediScan", "AgriSense", "SafeStep", "StudyBuddy", "CivicLoop", "CarbonCut", "BusTrack", "VoteSmart", "FarmLink", "SignBridge", "AquaWatch", "SkillMesh", "QueueLess", "GreenRoute", "WasteWise", "CareQueue", "LabLink", "NoteNest", "CommuteIQ"];

function pick(list, i) {
  return list[i % list.length];
}
function randInt(min, max) {
  return crypto.randomInt(min, max + 1);
}
function randomCode() {
  return code();
}
function digits(n) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += crypto.randomInt(10);
  return out;
}

async function demo() {
  const teamCount = Number(process.env.DEMO_TEAMS || 60);
  const judgeCount = Number(process.env.DEMO_JUDGES || 14);

  console.log(`demo: wiping operational data (keeping config, rubric, meals, admin)`);
  await q(`delete from scores`);
  await q(`delete from results`);
  await q(`delete from assignments`);
  await q(`delete from conflicts`);
  await q(`delete from submissions`);
  await q(`delete from meal_scans`);
  await q(`delete from participants`);
  await q(`delete from teams`);
  await q(`delete from judges`);
  await q(`delete from volunteers`);
  await q(`delete from audit_log`);
  await q(`delete from sessions`);

  const judgeIds = [];
  for (let j = 1; j <= judgeCount; j += 1) {
    const name = `${pick(FIRST, j * 3)} ${pick(LAST, j * 5)}`;
    const rows = await q(
      `insert into judges (name, email, invite_code) values ($1, $2, $3) returning id`,
      [name, `judge${j}@codespark.local`, randomCode()],
    );
    judgeIds.push(rows[0].id);
  }

  const volunteerRows = [];
  for (let v = 0; v < 8; v += 1) {
    const rows = await q(
      `insert into volunteers (name, code) values ($1, $2) returning id, name, code`,
      [`Volunteer ${v + 1}`, randomCode()],
    );
    volunteerRows.push(rows[0]);
  }

  const teamIds = [];
  for (let t = 0; t < teamCount; t += 1) {
    const project = `${pick(PROJECTS, t)}${t >= PROJECTS.length ? ` ${Math.floor(t / PROJECTS.length) + 1}` : ""}`;
    const verified = t % 6 !== 5;
    const rows = await q(
      `insert into teams (name, college, track, size, payment_verified, payment_ref)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        project,
        pick(COLLEGES, t),
        pick(TRACKS, t),
        3 + (t % 2),
        verified,
        verified ? `UPI-${digits(8)}` : null,
      ],
    );
    const teamId = rows[0].id;
    teamIds.push(teamId);
    const size = 3 + (t % 2);
    for (let p = 0; p < size; p += 1) {
      const name = `${pick(FIRST, t * 5 + p * 3)} ${pick(LAST, t * 7 + p * 2)}`;
      await q(
        `insert into participants (team_id, name, email, phone, is_leader, checked_in_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          teamId,
          name,
          `team${t + 1}.p${p + 1}@example.com`,
          `9${digits(9)}`,
          p === 0,
          t < 48 ? new Date("2026-11-12T03:15:00Z") : null,
        ],
      );
    }
  }

  // Screeners: every team gets 2 judges, balanced, skipping conflicts.
  const perJudge = Math.ceil((teamCount * 2) / judgeCount);
  let cursor = 0;
  const pairs = new Set();
  for (let t = 0; t < teamCount; t += 1) {
    for (let k = 0; k < 2; k += 1) {
      let guard = 0;
      while (guard < judgeCount) {
        const judgeIndex = (cursor + k + guard) % judgeCount;
        const key = `${judgeIds[judgeIndex]}:${teamIds[t]}`;
        if (!pairs.has(key)) {
          pairs.add(key);
          await q(
            `insert into assignments (judge_id, team_id, round) values ($1, $2, 'screening')`,
            [judgeIds[judgeIndex], teamIds[t]],
          );
          break;
        }
        guard += 1;
      }
    }
    cursor = (cursor + 1) % judgeCount;
  }
  void perJudge;

  // Scores for the first 40 teams so judging progress looks realistic.
  const rubricKeys = ["demo", "depth", "impact", "clarity"];
  const pending = await q(
    `select a.id as assignment_id, a.judge_id, a.team_id
       from assignments a join teams t on t.id = a.team_id
      where a.round = 'screening' order by t.name limit $1`,
    [40 * 2],
  );
  for (const row of pending) {
    for (const key of rubricKeys) {
      await q(
        `insert into scores (assignment_id, rubric_key, score, client_uuid)
         values ($1, $2, $3, $4)
         on conflict (assignment_id, rubric_key) do nothing`,
        [row.assignment_id, key, 5 + randInt(0, 50) / 10, crypto.randomUUID()],
      );
    }
  }

  // A few teams get real public repositories so the repo tracker can be
  // exercised locally without pointing at repositories that do not exist.
  const repoSeeds = [
    "https://github.com/vercel/next.js",
    "https://github.com/facebook/react",
    "https://github.com/microsoft/TypeScript",
    "https://github.com/tailwindlabs/tailwindcss",
    "https://github.com/neondatabase/serverless",
    "https://github.com/sindresorhus/ky",
    "https://github.com/oven-sh/bun",
    "https://github.com/honojs/hono",
  ];
  const repoTeams = await q(`select id from teams order by name limit $1`, [repoSeeds.length]);
  for (const [index, team] of repoTeams.entries()) {
    await q(
      `insert into submissions (team_id, repo_url, video_url, slides_url, track)
       values ($1, $2, $3, $4, $5)
       on conflict (team_id) do update set repo_url = excluded.repo_url`,
      [team.id, repoSeeds[index], `https://example.com/demo/${index + 1}`, null, null],
    );
  }
  console.log(`demo: ${repoTeams.length} teams have a repository for the tracker`);

  const counts = await q(
    `select
       (select count(*) from teams) as teams,
       (select count(*) from participants) as participants,
       (select count(*) from judges) as judges,
       (select count(*) from assignments) as assignments,
       (select count(*) from scores) as scores`,
  );
  console.log("demo:", counts[0]);
  console.log("demo: volunteer codes and judge codes are visible at /admin/judging");
}

/**
 * Load the real registration sheet (data/codespark-teams.csv, generated from
 * "CodeSpark Teams list.xlsx") into teams + participants. Idempotent: teams are
 * matched on name + college, people on email, then phone, then team + name.
 * Writes no check-ins, scans or scores.
 */
async function teams() {
  const file = resolve(ROOT, process.env.TEAMS_CSV || "data/codespark-teams.csv");
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const parsed = Papa.parse(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
  const rows = parsed.data.filter((row) => row.team_name && row.participant_name);
  if (rows.length === 0) throw new Error("no rows in the team sheet");

  const digits = (value) => String(value || "").replace(/\D/g, "").slice(-10);
  const keyOf = (row) => `${row.team_name.trim().toLowerCase()}|${(row.college || "").trim().toLowerCase()}`;

  const teamSeeds = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const current = teamSeeds.get(key);
    if (current) {
      current.members += 1;
      current.size = Math.max(current.size, Number(row.team_size) || 1, current.members);
      continue;
    }
    teamSeeds.set(key, {
      name: row.team_name.trim(),
      college: (row.college || "").trim(),
      size: Number(row.team_size) || 1,
      members: 1,
    });
  }

  const teamIds = new Map();
  for (const team of teamSeeds.values()) {
    const inserted = await q(
      `insert into teams (name, college, size) values ($1, $2, $3)
       on conflict (lower(name), lower(coalesce(college, ''))) do update set
         size = greatest(teams.size, excluded.size), updated_at = now()
       returning id`,
      [team.name, team.college, team.size],
    );
    teamIds.set(`${team.name.toLowerCase()}|${team.college.toLowerCase()}`, inserted[0].id);
  }

  const existing = await q(
    `select id, lower(email) as email,
            right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) as phone,
            team_id, lower(name) as name
       from participants`,
  );
  const emailToId = new Map();
  const phoneToId = new Map();
  for (const person of existing) {
    if (person.email) emailToId.set(person.email, person.id);
    if (person.phone) phoneToId.set(person.phone, person.id);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const teamId = teamIds.get(keyOf(row));
    if (!teamId) {
      skipped += 1;
      continue;
    }
    const email = (row.email || "").trim().toLowerCase() || null;
    const phone = digits(row.phone) || null;
    const leader = String(row.is_leader || "").toLowerCase() === "true";
    const name = row.participant_name.trim();
    const match =
      (email && emailToId.get(email)) ||
      (phone && phoneToId.get(phone)) ||
      existing.find(
        (person) => person.team_id === teamId && person.name === name.toLowerCase(),
      )?.id;

    if (match) {
      await q(
        `update participants set team_id = $2, name = $3, email = coalesce($4, email),
                phone = coalesce($5, phone), is_leader = is_leader or $6
          where id = $1`,
        [match, teamId, name, email, phone, leader],
      );
      updated += 1;
      continue;
    }

    const inserted = await q(
      `insert into participants (team_id, name, email, phone, is_leader)
       values ($1, $2, $3, $4, $5) returning id`,
      [teamId, name, email, phone, leader],
    );
    existing.push({ id: inserted[0].id, name: name.toLowerCase(), team_id: teamId, email, phone });
    if (email) emailToId.set(email, inserted[0].id);
    if (phone) phoneToId.set(phone, inserted[0].id);
    added += 1;
  }

  const counts = await q(
    `select (select count(*) from teams)::int as teams,
            (select count(*) from participants)::int as participants`,
  );
  console.log(`teams: ${teamIds.size} teams in sheet · ${added} people added, ${updated} updated, ${skipped} skipped`);
  console.log(`teams: database now has ${counts[0].teams} teams and ${counts[0].participants} participants`);
}

async function reset() {
  const rows = await q(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) {
    console.log("reset: nothing to drop");
    return;
  }
  await q(`drop table if exists ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
  console.log(`reset: dropped ${rows.length} tables`);
}

const command = process.argv[2] || "migrate";
const commands = { migrate, seed, demo, teams, reset };
if (!commands[command]) {
  console.error(`unknown command: ${command}. Use migrate | seed | demo | teams | reset`);
  process.exit(1);
}
commands[command]().catch((error) => {
  console.error(`${command} failed:`, error.message);
  process.exit(1);
});
