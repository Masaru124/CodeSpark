/**
 * Every stored table, in one place, so the admin export page and the download
 * route can never drift apart. CSV downloads reuse these queries; "all" returns
 * the same views as one JSON file.
 */
export type ExportDef = {
  label: string;
  filename: string;
  group: "Registration" | "Check-in & meals" | "Submissions" | "Judging" | "Operations";
  sql: string;
};

export const EXPORTS: Record<string, ExportDef> = {
  teams: {
    label: "Teams",
    filename: "codespark-teams.csv",
    group: "Registration",
    sql: `select t.name as team, t.college, t.track, t.size, t.payment_verified, t.payment_ref,
                 t.status, t.notes,
                 (select count(*) from participants p where p.team_id = t.id)::int as members,
                 (select count(*) from participants p where p.team_id = t.id
                    and p.checked_in_at is not null)::int as checked_in,
                 t.created_at, t.updated_at
            from teams t
           order by t.name`,
  },
  participants: {
    label: "Participants",
    filename: "codespark-participants.csv",
    group: "Registration",
    sql: `select t.name as team, p.name as participant, p.email, p.phone, p.is_leader,
                 p.checked_in_at, p.created_at
            from participants p join teams t on t.id = p.team_id
           order by t.name, p.is_leader desc, p.name`,
  },
  checkins: {
    label: "Check-ins",
    filename: "codespark-checkins.csv",
    group: "Check-in & meals",
    sql: `select t.name as team, p.name as participant, p.email, p.phone, p.checked_in_at
            from participants p join teams t on t.id = p.team_id
           where p.checked_in_at is not null
           order by p.checked_in_at`,
  },
  meals: {
    label: "Meal scans",
    filename: "codespark-meal-scans.csv",
    group: "Check-in & meals",
    sql: `select t.name as team, p.name as participant, p.email, p.phone,
                 ms.meal_key, ms.scanned_by, ms.scanned_at
            from meal_scans ms
            join participants p on p.id = ms.participant_id
            join teams t on t.id = ms.team_id
           order by ms.scanned_at`,
  },
  submissions: {
    label: "Submissions (full)",
    filename: "codespark-submissions.csv",
    group: "Submissions",
    sql: `select t.name as team, t.college, t.size as team_size,
                 lead.name as lead_name, lead.email as lead_email, lead.phone as lead_phone,
                 s.track as submitted_track, t.track as team_track,
                 s.repo_url, s.video_url, s.slides_url, s.notes,
                 s.repo_public, s.first_commit_at, s.commit_flag,
                 rs.repo_full_name, rs.default_branch, rs.total_commits, rs.authors,
                 rs.stars, rs.forks, rs.open_issues, rs.last_commit_at,
                 rs.last_checked_at, rs.error as repo_error,
                 s.submitted_at, s.updated_at
            from submissions s
            join teams t on t.id = s.team_id
            left join lateral (
              select p.name, p.email, p.phone
                from participants p
               where p.team_id = t.id and p.is_leader
               order by p.created_at
               limit 1
            ) lead on true
            left join repo_stats rs on rs.team_id = s.team_id
           order by t.name`,
  },
  scores: {
    label: "Scores (both phases)",
    filename: "codespark-scores.csv",
    group: "Judging",
    sql: `select t.name as team, a.round as phase, j.name as judge,
                 rb.key as criterion_key, rb.label as criterion, rb.weight,
                 s.score, s.comment, s.updated_at
            from scores s
            join assignments a on a.id = s.assignment_id
            join teams t on t.id = a.team_id
            join judges j on j.id = a.judge_id
            join rubric rb on rb.key = s.rubric_key
           order by t.name, a.round, j.name, rb.sort`,
  },
  assignments: {
    label: "Judge assignments",
    filename: "codespark-assignments.csv",
    group: "Judging",
    sql: `select t.name as team, j.name as judge, a.round as phase,
                 (select count(distinct s.rubric_key) from scores s where s.assignment_id = a.id)::int as criteria_scored,
                 a.created_at
            from assignments a
            join teams t on t.id = a.team_id
            join judges j on j.id = a.judge_id
           order by t.name, a.round, j.name`,
  },
  results: {
    label: "Published results",
    filename: "codespark-results.csv",
    group: "Judging",
    sql: `select r.rank, t.name as team, t.college, t.track,
                 r.screening_total::float as screening_total,
                 r.final_total::float as final_total,
                 r.published, r.computed_at
            from results r join teams t on t.id = r.team_id
           order by r.rank nulls last, t.name`,
  },
  conflicts: {
    label: "Judge conflicts",
    filename: "codespark-conflicts.csv",
    group: "Judging",
    sql: `select j.name as judge, t.name as team, c.reason
            from conflicts c
            join judges j on j.id = c.judge_id
            join teams t on t.id = c.team_id
           order by j.name, t.name`,
  },
  judges: {
    label: "Judges",
    filename: "codespark-judges.csv",
    group: "Operations",
    sql: `select name, email, invite_code, active, created_at from judges order by name`,
  },
  volunteers: {
    label: "Volunteers",
    filename: "codespark-volunteers.csv",
    group: "Operations",
    sql: `select name, code, active, created_at from volunteers order by name`,
  },
  repos: {
    label: "Repository stats",
    filename: "codespark-repos.csv",
    group: "Operations",
    sql: `select t.name as team, r.repo_full_name, r.default_branch, r.repo_public,
                 r.stars, r.forks, r.open_issues, r.total_commits, r.authors,
                 r.first_commit_at, r.last_commit_at, r.last_checked_at, r.error
            from repo_stats r join teams t on t.id = r.team_id
           order by t.name`,
  },
  commits: {
    label: "Commit history",
    filename: "codespark-commits.csv",
    group: "Operations",
    sql: `select t.name as team, c.sha, c.author, c.message, c.committed_at, c.seen_at
            from repo_commits c join teams t on t.id = c.team_id
           order by c.committed_at desc`,
  },
  audit: {
    label: "Audit log",
    filename: "codespark-audit.csv",
    group: "Operations",
    sql: `select id, at, actor, role, action, entity, entity_id, payload::text as payload
            from audit_log order by at desc`,
  },
  config: {
    label: "Event configuration",
    filename: "codespark-config.csv",
    group: "Operations",
    sql: `select key, value::text as value, updated_at from event_config order by key`,
  },
};

export const EXPORT_GROUPS = [
  "Registration",
  "Check-in & meals",
  "Submissions",
  "Judging",
  "Operations",
] as const;
