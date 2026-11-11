# Code Spark Ops

Operations console for **CODE SPARK 2026** (12 Nov 2026, AMC Engineering College): registration
import (XLSX or CSV), **one HMAC-signed QR pass per team**, lead-only check-in, deadline-enforced submissions, two-phase rubric judging (screening + finalist) with
manual or automatic assignment and offline queues, statistics/report, full data export, and a
publish gate on results.

Implements `prd.md` / `spec.md`, with one deliberate change: **Neon Postgres** replaces Supabase.
There is no Supabase RLS here — every query runs through the server with explicit role checks
(details below).

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 15 App Router, React 19, TypeScript, Tailwind |
| Database | Neon Postgres via `@neondatabase/serverless` HTTP driver |
| Auth | Password (PBKDF2-SHA256) for admins, invite codes for judges/volunteers, hashed session tokens in a cookie |
| QR | `qrcode.react` render, HMAC-SHA256 token verified server-side |
| Scan | `html5-qrcode` camera + manual entry + cached roster |
| Offline | IndexedDB queue (`src/lib/offline.ts`) for scans and score sheets |
| CSV | `papaparse` for import and export |
| Repo tracker | GitHub REST API: visibility, first commit, last 100 commits, lifetime count |

## Setup

```bash
npm install
cp .env.example .env.local     # then fill DATABASE_URL and QR_SECRET
npm run db:migrate             # create tables, rubric, meals, event config
npm run db:seed                # create the admin login from ADMIN_EMAIL / ADMIN_PASSWORD
node scripts/db.mjs teams      # load the real registration sheet (data/codespark-teams.csv)
npm run db:demo                # optional: 60 fake teams + 14 judges + scores (do not mix with real data)
npm run dev                    # http://localhost:3000
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use Neon's **pooled** connection string (`...-pooler...`) for `DATABASE_URL`.

### Logins

* Admin: `ADMIN_EMAIL` / `ADMIN_PASSWORD` at `/login` → `/admin`
* Judge: 6-character code, created at `/admin/staff`
* Volunteer: 6-character code, created at `/admin/staff`
* Participant: no login — the signed pass link `/pass/<token>` is their credential

### Demo data

`npm run db:demo` wipes operational data (teams, scans, scores, sessions) and loads 60 teams,
240 participants, 14 judges with invite codes and partial screening scores. It prints the counts
and the codes live at `/admin/staff`.

## Roles and what each surface does

| Surface | Auth | Contents |
|---|---|---|
| `/` | public | Landing page, event timeline |
| `/login` | public | Admin password, judge/volunteer code |
| `/admin` | admin | Counters, team check-in, judging coverage, recent audit |
| `/admin/import` | admin | XLSX/CSV upload or paste, team-wide or one-row-per-person layout, idempotent upsert |
| `/admin/teams`, `/admin/teams/[id]` | admin | Payment verification, the team's single printable QR pass, member list |
| `/admin/staff` | admin | Create/disable judges and volunteers, show their codes |
| `/admin/judging` | admin | Auto or manual per-judge assignment (both phases), coverage, outlier flags, conflicts |
| `/admin/results` | admin | Live ranking, finalist round, publish gate, repo flags, CSV exports |
| `/admin/report` | admin | Statistics, phase-by-phase coverage, top 10, track averages, printable report |
| `/admin/export` | admin | Every stored table as CSV, plus a one-file JSON dump |
| `/admin/repos` | admin | Submitted repositories, commit history, stars, manual and batch sync |
| `/admin/audit` | admin | Audit trail |
| `/volunteer` | volunteer/admin | Camera scanner for team-lead check-in, offline queue |
| `/judge`, `/judge/[assignmentId]` | judge (own assignments only) | Team list, rubric scoring, queued sync |
| `/pass/[token]` | token holder | QR pass, schedule, rules, submission form, own scores |
| `/results` | public | Leaderboard, only after publish |
| `/api/health` | public | DB liveness |

## Rules the code enforces

* **One pass per team.** The QR carries `/pass/<token>` for the team; scanning checks in the
  **team lead only**. Meals are not scanned at this event, so the scanner has a single mode and the
  meal tables are left untouched (existing rows still export).
* **Check-in once.** Only the lead's `participants.checked_in_at` is written, only when null;
  repeat scans return amber instead of creating a second record.
* **No forged passes.** Token = team UUID + truncated HMAC-SHA256; signature verified before any
  database read. The scanner shows the team and lead name so a shared screenshot is visible.
* **Submission cutoff.** Enforced server-side against `event_config.event.submission_deadline`
  (17:30 IST by default), independent of device clocks.
* **Repo rules.** Public repo and first-commit time are read from GitHub and *flagged* for a human,
  never auto-disqualified.
* **Judging integrity.** A judge can only read/write assignments they own (`judge_id = session`),
  conflicts are excluded at assignment time, and a score sheet only counts when all four criteria are
  present.
* **Publish gate.** `/results` and per-team score sheets read `event_config.publish`; nothing is
  visible before an admin publishes.
* **Audit trail.** Imports, payment verification, judge/volunteer creation, assignments, score syncs,
  submissions and publishes are written to `audit_log`.

## Repo tracker

`/admin/repos` tracks every submitted GitHub repository and keeps its commit history in Postgres.

* **Tables.** `repo_stats` holds the last known GitHub state per team (visibility, branch, stars,
  forks, open issues, lifetime commit count, authors, first/last commit, last check, error).
  `repo_commits` holds the most recent 100 commits per repository, keyed by `(team_id, sha)` so a
  re-sync can never duplicate a commit.
* **Sync.** `syncTeamRepo` makes at most three GitHub calls — repository metadata, newest 100 commits
  (lifetime count read from the `Link` header), and the earliest commit only while it is unknown —
  then writes the snapshot. Failures land in `repo_stats.error`; nothing throws into the page.
* **Batches.** `syncRepoBatch` sweeps the repositories checked longest ago, four at a time, and stops
  when GitHub's remaining quota reaches 3. Unauthenticated GitHub allows 60 requests/hour (about 20
  repository syncs), so set `GITHUB_TOKEN` for a full 60-team sweep.
* **Automation.** `POST /api/admin/repo-sync` accepts `{"limit": 60}` or `{"teamId": "…"}` and is
  authorised by an admin session or an `x-repo-sync-token` header matching `REPO_SYNC_TOKEN`. Every
  sync is written to the audit log.
* **Flags, not verdicts.** The tracker feeds `submissions.repo_public` and
  `submissions.first_commit_at`, so the publish gate still flags private repositories and
  pre-kickoff commits for a human decision.

## Design for concurrency (500 simultaneous users)

The event itself peaks around 200 scans in 30 minutes; 500 concurrent sessions is the sizing target
with headroom.

1. **Stateless database access.** The Neon HTTP driver sends each query as one HTTPS request through
   Neon's pooler. No connection is held between requests, so a burst of phones cannot exhaust a
   connection pool, and Workers scale horizontally per request.
2. **Hot paths are single-round-trip.** Overview counters are one aggregate query; the scanner
   resolves and writes in at most three. Bulk import and bulk assignment are chunked multi-row
   statements (200–300 rows), not per-row loops.
3. **Short-TTL in-isolate caches** for event config (5 s) and the scanner roster (30 s) keep hundreds
   of devices from re-reading constants on every tap. Publishing clears the config cache immediately.
4. **Indexes on every lookup path**: `lower(email)`, last-10-digit phone, `assignments(judge_id,round)`,
   `assignments(team_id,round)`, `meal_scans(meal_key,scanned_at)`, `sessions(expires_at)`.
5. **Write idempotency.** Scans carry a `client_uuid`; check-in only writes when
   `checked_in_at is null`; score upserts are keyed by `(assignment_id, rubric_key)`; queue retries
   therefore cannot duplicate.
6. **Rate limits** in Postgres per staff member for `scan`, `score sync`, and per IP for `login`
   (fixed window, one statement).
   Tunable without a rebuild: `SCAN_RATE_LIMIT_PER_MIN` (300), `SCORE_RATE_LIMIT_PER_MIN` (240),
   `LOGIN_RATE_LIMIT_PER_MIN` (12).
7. **Personalised responses are `no-store`**; nothing sensitive is cached at the edge.
8. **Client work is deferred**: camera decoding and queueing happen on the phone, not the server.

### Measured (production build, one local process, Neon over ~50 ms RTT)

Single user, real browser (`node scripts/perf-browser.mjs`):

| Page | TTFB | load | JS |
|---|---|---|---|
| `/` | 39 ms | 138 ms | 106 kB |
| `/login` | 7 ms | 87 ms | — |
| `/results` | 236 ms | 302 ms | — |
| participant pass | 479 ms | 574 ms | — |
| `/admin` | 253 ms | 345 ms | — |
| `/admin/repos` | 256 ms | 379 ms | — |

Concurrent load (`autocannon`, 8 s per run, `/results` is the heaviest public page):

| In flight | Throughput | p50 | p99 | Non-2xx |
|---|---|---|---|---|
| 50 | ~229 req/s | 171 ms | 1.07 s | 0 |
| 100 | ~251 req/s | 341 ms | 2.5 s | 0 |
| 500 | ~95–160 req/s | ~6 s | ~7.8 s | 0 |

Reading: one Node process serves ~190–250 req/s and stays sub-second up to about 100 simultaneous
connections. At 500 truly simultaneous connections latency degrades into seconds, but every request
still returns 200 — it slows down, it does not fall over. A real 500-person event is far below that:
if every attendee loads a page every 20 seconds it is ~25 req/s.

To hold sub-second latency at 500 simultaneous connections, run two or more app instances (the app is
stateless — sessions, rate limits and data all live in Postgres) and give Neon at least 1 CU of
compute; the database round trip, not the framework, is the floor. The announcement burst is already
absorbed by short caches: event config and the published leaderboard for 5 s, session lookups for 5 s,
and the scanner roster for 30 s.

Functional coverage: `node scripts/smoke.mjs` (29 checks: auth guards, signed passes, duplicate
check-in rejection, forged-token rejection, judge ownership, CSV export), plus a manual
publish/unpublish pass through the real UI.

## Testing

Three suites, all against a real server and the real Neon database:

```bash
npm run e2e                # Playwright: 26 end-to-end checks across every surface
node scripts/smoke.mjs     # 29 HTTP checks: guards, scans, scoring, exports
npm run loadtest           # 500 concurrent scans against /api/scan
```

The Playwright suite drives Chromium through the public pages, every admin navigation link, payment
verification, staff add/disable/enable, CSV import, auto-assignment, the repo tracker, a CSV download,
publish/unpublish, logout, the volunteer scanner (manual scan, duplicate refusal, name search,
camera fallback), judge login and score-sheet persistence, and the participant pass
(QR, submission, invalid URL). It writes a team named `E2E Robotics` and staff named `E2E Judge …` /
`E2E Desk …`, so run it against demo data or delete those rows afterwards. `npx playwright show-report`
opens the HTML report after a failure.

## Security notes

* `DATABASE_URL`, `QR_SECRET` and `GITHUB_TOKEN` are server-only; nothing is exposed via
  `NEXT_PUBLIC_*`.
* Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production, 14-hour expiry, random 32-byte
  token stored only as a SHA-256 hash.
* Admin passwords are PBKDF2-SHA256 (120k iterations) with a per-user salt; login timing is constant
  whether or not the account exists.
* Pass tokens are unguessable (HMAC), but a pass does not grant access to other teams' data.
* All SQL is parameterised; no string-built SQL from user input (bulk statements only build
  placeholder lists).
* No payment details are stored — only a verified flag and a reference.

## Deployment (Freebuff Sites / Cloudflare Workers)

The app is a standard Next.js App Router project with no Node-only dependencies, so it deploys via
the OpenNext Workers adapter.

```bash
npx @opennextjs/cloudflare build       # produces .open-next/worker.js
```

Secrets to set in the hosting environment: `DATABASE_URL`, `QR_SECRET`, `GITHUB_TOKEN` (optional but
recommended for the repo tracker), `REPO_SYNC_TOKEN` (optional, for scheduled syncs), `RESEND_*`
(optional). Then run `npm run db:migrate` against the production database.

## Operational runbook

* **Before doors:** `/admin` counters correct, `/api/health` green, 2 devices per desk logged in,
  printed passes and printed team lists in hand.
* **Every 30 minutes:** check dashboard counters; export `teams` and `scans` CSV at 10:00 and 15:00.
* **Wi-Fi down:** volunteers keep scanning offline (queue syncs on reconnect), judges keep scoring
  offline; printed lists remain authoritative for the desk.
* **Duplicate scan complaint:** the pass page shows the original check-in time; the dashboard has
  the team count.
* **After the event:** export every CSV, then delete personal data per college policy.
