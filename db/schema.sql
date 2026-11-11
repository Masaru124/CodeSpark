-- Code Spark Ops — Neon Postgres schema
-- Idempotent: safe to run repeatedly (npm run db:migrate).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- config
create table if not exists event_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- teams
create table if not exists teams (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  college          text,
  track            text,
  size             int not null default 1,
  payment_verified boolean not null default false,
  payment_ref      text,
  status           text not null default 'registered',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists teams_name_college_key
  on teams (lower(name), lower(coalesce(college, '')));
create index if not exists teams_verified_idx on teams (payment_verified);

-- ---------------------------------------------------------- participants
create table if not exists participants (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  is_leader     boolean not null default false,
  checked_in_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists participants_email_key
  on participants (lower(email)) where email is not null;
create unique index if not exists participants_phone_key
  on participants (right(regexp_replace(phone, '\D', '', 'g'), 10)) where phone is not null;
create index if not exists participants_team_idx on participants (team_id);
create index if not exists participants_checked_in_idx on participants (checked_in_at);

-- ----------------------------------------------------------------- meals
create table if not exists meals (
  key    text primary key,
  label  text not null,
  active boolean not null default true,
  sort   int not null default 0
);

create table if not exists meal_scans (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  meal_key       text not null references meals(key),
  scanned_by     text,
  client_uuid    text unique,
  scanned_at     timestamptz not null default now(),
  unique (participant_id, meal_key)
);
create index if not exists meal_scans_meal_idx on meal_scans (meal_key, scanned_at);
create index if not exists meal_scans_team_idx on meal_scans (team_id);

-- ----------------------------------------------------------- submissions
create table if not exists submissions (
  team_id         uuid primary key references teams(id) on delete cascade,
  repo_url        text not null,
  video_url       text,
  slides_url      text,
  track           text,
  first_commit_at timestamptz,
  repo_public     boolean,
  commit_flag     text,
  notes           text,
  submitted_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------- staff & judging
create table if not exists judges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  invite_code text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists volunteers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists conflicts (
  judge_id uuid not null references judges(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  reason   text,
  primary key (judge_id, team_id)
);

create table if not exists assignments (
  id       uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  round    text not null default 'screening',
  checked_in_team boolean not null default false,
  created_at timestamptz not null default now(),
  unique (judge_id, team_id, round)
);
create index if not exists assignments_judge_idx on assignments (judge_id, round);
create index if not exists assignments_team_idx on assignments (team_id, round);

create table if not exists rubric (
  key       text primary key,
  label     text not null,
  weight    int not null,
  max_score numeric(4, 2) not null default 10,
  sort      int not null default 0
);

create table if not exists scores (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  rubric_key    text not null references rubric(key),
  score         numeric(4, 2) not null,
  comment       text,
  client_uuid   text not null unique,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, rubric_key)
);
create index if not exists scores_assignment_idx on scores (assignment_id);

create table if not exists results (
  team_id         uuid primary key references teams(id) on delete cascade,
  screening_total numeric(6, 2),
  final_total     numeric(6, 2),
  rank            int,
  published       boolean not null default false,
  computed_at     timestamptz not null default now()
);

-- ------------------------------------------------------- infra / security
create table if not exists audit_log (
  id        bigserial primary key,
  actor     text not null,
  role      text not null,
  action    text not null,
  entity    text,
  entity_id text,
  payload   jsonb,
  at        timestamptz not null default now()
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_action_idx on audit_log (action);

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role       text not null,
  subject_id uuid,
  label      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_expiry_idx on sessions (expires_at);

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null default 'Admin',
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);

-- ------------------------------------------------------------- seed data
insert into meals (key, label, sort) values
  ('lunch', 'Lunch', 1),
  ('snacks', 'Snacks', 2),
  ('dinner', 'Dinner', 3)
on conflict (key) do nothing;

insert into rubric (key, label, weight, max_score, sort) values
  ('demo', 'Working demo / completeness', 30, 10, 1),
  ('depth', 'Technical depth', 25, 10, 2),
  ('impact', 'Impact / problem relevance', 25, 10, 3),
  ('clarity', 'Presentation / clarity', 20, 10, 4)
on conflict (key) do nothing;

insert into event_config (key, value) values
  ('event', '{"name":"CODE SPARK 2026","venue":"AMC Engineering College, Bengaluru","starts_at":"2026-11-12T08:30:00+05:30","hack_start":"2026-11-12T09:40:00+05:30","submission_deadline":"2026-11-12T17:30:00+05:30","results_at":"2026-11-12T20:50:00+05:30"}'::jsonb),
  ('judging', '{"finalists":10,"screening_weight":0.3,"final_weight":0.7,"outlier_threshold":2}'::jsonb),
  ('publish', '{"published":false,"published_at":null}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------- migrations
-- Registration sheets only carry a lead's email/phone, so teammates are stored
-- by name alone. Existing installs are migrated to the nullable shape here.
alter table participants alter column email drop not null;
alter table participants alter column phone drop not null;

drop index if exists teams_name_key;
create unique index if not exists teams_name_college_key
  on teams (lower(name), lower(coalesce(college, '')));

drop index if exists participants_email_key;
drop index if exists participants_phone_key;
create unique index if not exists participants_email_key
  on participants (lower(email)) where email is not null;
create unique index if not exists participants_phone_key
  on participants (right(regexp_replace(phone, '\D', '', 'g'), 10)) where phone is not null;

-- Hot-path indexes for the team-pass scanner and the public leaderboard.
create index if not exists meal_scans_team_meal_idx
  on meal_scans (team_id, meal_key, participant_id);
create index if not exists participants_team_checkin_idx
  on participants (team_id, checked_in_at);
create index if not exists results_published_rank_idx
  on results (published, rank);

-- ------------------------------------------------------------ repo tracker
-- One row per team with a submitted repository: last known GitHub state.
-- Mirrors the last sync so the console renders without calling GitHub.
create table if not exists repo_stats (
  team_id         uuid primary key references teams(id) on delete cascade,
  repo_full_name  text,
  default_branch  text,
  repo_public     boolean,
  stars           int not null default 0,
  forks           int not null default 0,
  open_issues     int not null default 0,
  total_commits   int,
  authors         int not null default 0,
  first_commit_at timestamptz,
  last_commit_at  timestamptz,
  last_checked_at timestamptz,
  error           text
);
create index if not exists repo_stats_checked_idx on repo_stats (last_checked_at);
create index if not exists repo_stats_last_commit_idx on repo_stats (last_commit_at desc);

-- Commit history pulled from GitHub. Primary key on (team_id, sha) makes a
-- re-sync idempotent: the same commit is never counted twice.
create table if not exists repo_commits (
  team_id      uuid not null references teams(id) on delete cascade,
  sha          text not null,
  author       text,
  message      text,
  committed_at timestamptz not null,
  seen_at      timestamptz not null default now(),
  primary key (team_id, sha)
);
create index if not exists repo_commits_team_idx on repo_commits (team_id, committed_at desc);
create index if not exists repo_commits_time_idx on repo_commits (committed_at desc);
-- ------------------------------------------------------------ live revision
-- One global revision, bumped by every data change. Clients poll /api/live
-- (a single-row read) and re-render in place when the number moves.
create table if not exists live_state (
  id         int primary key default 1 check (id = 1),
  revision   bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into live_state (id) values (1) on conflict (id) do nothing;

create or replace function bump_live() returns trigger language plpgsql as '
begin
  update live_state set revision = revision + 1, updated_at = now() where id = 1;
  return null;
end;
';

drop trigger if exists live_bump_teams on teams;
create trigger live_bump_teams after insert or update or delete on teams for each statement execute function bump_live();

drop trigger if exists live_bump_participants on participants;
create trigger live_bump_participants after insert or update or delete on participants for each statement execute function bump_live();

drop trigger if exists live_bump_meal_scans on meal_scans;
create trigger live_bump_meal_scans after insert or update or delete on meal_scans for each statement execute function bump_live();

drop trigger if exists live_bump_assignments on assignments;
create trigger live_bump_assignments after insert or update or delete on assignments for each statement execute function bump_live();

drop trigger if exists live_bump_scores on scores;
create trigger live_bump_scores after insert or update or delete on scores for each statement execute function bump_live();

drop trigger if exists live_bump_submissions on submissions;
create trigger live_bump_submissions after insert or update or delete on submissions for each statement execute function bump_live();

drop trigger if exists live_bump_results on results;
create trigger live_bump_results after insert or update or delete on results for each statement execute function bump_live();

drop trigger if exists live_bump_conflicts on conflicts;
create trigger live_bump_conflicts after insert or update or delete on conflicts for each statement execute function bump_live();

drop trigger if exists live_bump_judges on judges;
create trigger live_bump_judges after insert or update or delete on judges for each statement execute function bump_live();

drop trigger if exists live_bump_volunteers on volunteers;
create trigger live_bump_volunteers after insert or update or delete on volunteers for each statement execute function bump_live();

drop trigger if exists live_bump_repo_stats on repo_stats;
create trigger live_bump_repo_stats after insert or update or delete on repo_stats for each statement execute function bump_live();

drop trigger if exists live_bump_repo_commits on repo_commits;
create trigger live_bump_repo_commits after insert or update or delete on repo_commits for each statement execute function bump_live();

drop trigger if exists live_bump_audit on audit_log;
create trigger live_bump_audit after insert or update or delete on audit_log for each statement execute function bump_live();

drop trigger if exists live_bump_config on event_config;
create trigger live_bump_config after insert or update or delete on event_config for each statement execute function bump_live();
-- ----------------------------------------------------------- github quota
-- Last seen GitHub quota, shared across instances. Calls are refused while
-- exhausted instead of provoking 403s, and cached repo data keeps rendering.
create table if not exists github_state (
  id          int primary key default 1 check (id = 1),
  remaining   int,
  limit_total int,
  reset_at    timestamptz,
  checked_at  timestamptz,
  updated_at  timestamptz not null default now()
);
insert into github_state (id) values (1) on conflict (id) do nothing;
