"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { q, one } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recordAudit } from "@/lib/api";
import { randomCode } from "@/lib/crypto";
import { getConfig, setConfig } from "@/lib/config";
import { computeRankings } from "@/lib/judging";
import { inspectRepo } from "@/lib/github";
import { syncRepoBatch, syncTeamRepo } from "@/lib/repoTracker";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login?next=/admin");
  return session;
}

function back(path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(query ? `${path}?${query}` : path);
}

/** Next.js redirects travel as thrown errors — a catch must never swallow one. */
function isRedirectError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(-10);
const asBool = (value: unknown) =>
  ["1", "true", "yes", "y", "verified", "paid"].includes(String(value ?? "").trim().toLowerCase());

// ------------------------------------------------------------------- import
const HEADER_ALIASES: Record<string, string> = {
  team: "team_name",
  "team name": "team_name",
  project: "team_name",
  "project name": "team_name",
  college: "college",
  institution: "college",
  track: "track",
  theme: "track",
  name: "participant_name",
  "participant name": "participant_name",
  "full name": "participant_name",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "phone (whatsapp)": "phone",
  size: "team_size",
  "team size": "team_size",
  paid: "payment_verified",
  verified: "payment_verified",
  "payment verified": "payment_verified",
  "payment reference": "payment_ref",
  "payment ref": "payment_ref",
  ref: "payment_ref",
  leader: "is_leader",
};

export async function importCsv(formData: FormData) {
  const session = await requireAdmin();
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");

  let text = pasted.trim();
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) back("/admin/import", { error: "CSV is larger than 2 MB" });
    text = (await file.text()).trim();
  }
  if (!text) back("/admin/import", { error: "Paste a CSV or choose a file" });

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => {
      const clean = header.trim().toLowerCase();
      return HEADER_ALIASES[clean] ?? clean.replace(/\s+/g, "_");
    },
  });

  const rows = parsed.data.filter((row) => row.email || row.participant_name);
  if (rows.length === 0) back("/admin/import", { error: "No usable rows found in the CSV" });
  if (rows.length > 2000) back("/admin/import", { error: "Import at most 2000 rows at a time" });

  let skipped = 0;

  // 1. Normalise and dedupe inside the file (last row wins per email).
  type Row = {
    teamName: string;
    college: string | null;
    track: string | null;
    size: number;
    verified: boolean;
    paymentRef: string | null;
    email: string;
    phone: string;
    name: string;
    isLeader: boolean;
  };
  const byEmail = new Map<string, Row>();
  const phoneOwner = new Map<string, string>();

  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    const phone = digitsOnly(row.phone || "");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.length !== 10) {
      skipped += 1;
      continue;
    }
    const owner = phoneOwner.get(phone);
    if (owner && owner !== email) {
      skipped += 1;
      continue;
    }
    phoneOwner.set(phone, email);
    byEmail.set(email, {
      teamName: (row.team_name || row.college || "Unnamed team").trim().slice(0, 120),
      college: (row.college || "").trim().slice(0, 120) || null,
      track: (row.track || "").trim().slice(0, 80) || null,
      size: Math.max(1, Math.min(10, Number(row.team_size) || 1)),
      verified: asBool(row.payment_verified),
      paymentRef: (row.payment_ref || "").trim().slice(0, 120) || null,
      email,
      phone,
      name: (row.participant_name || email.split("@")[0] || "Participant").trim().slice(0, 120),
      isLeader: asBool(row.is_leader),
    });
  }

  if (byEmail.size === 0) {
    back("/admin/import", { error: "No valid rows (email + 10-digit phone required)" });
  }

  try {
    // 2. Reject rows whose phone already belongs to a different person.
    const existing = await q<{ email: string; phone: string }>(
      `select lower(email) as email, right(regexp_replace(phone, '\\D', '', 'g'), 10) as phone
         from participants`,
    );
    const dbPhoneOwner = new Map(existing.map((row) => [row.phone, row.email]));
    const keep: Row[] = [];
    for (const row of byEmail.values()) {
      const owner = dbPhoneOwner.get(row.phone);
      if (owner && owner !== row.email) {
        skipped += 1;
        continue;
      }
      keep.push(row);
    }

    // 3. Upsert teams in bulk, then map name -> id.
    const teams = new Map<
      string,
      { teamName: string; college: string | null; track: string | null; size: number; verified: boolean; paymentRef: string | null }
    >();
    for (const row of keep) {
      const key = row.teamName.toLowerCase();
      const current = teams.get(key);
      if (!current) {
        teams.set(key, {
          teamName: row.teamName,
          college: row.college,
          track: row.track,
          size: row.size,
          verified: row.verified,
          paymentRef: row.paymentRef,
        });
        continue;
      }
      teams.set(key, {
        ...current,
        college: current.college ?? row.college,
        track: current.track ?? row.track,
        size: Math.max(current.size, row.size),
        verified: current.verified || row.verified,
        paymentRef: current.paymentRef ?? row.paymentRef,
      });
    }

    const teamList = [...teams.values()];
    const teamIds = new Map<string, string>();
    for (let i = 0; i < teamList.length; i += 200) {
      const chunk = teamList.slice(i, i + 200);
      const values = chunk
        .map((_, index) => {
          const base = index * 6;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
        })
        .join(", ");
      const inserted = await q<{ id: string; key: string }>(
        `insert into teams (name, college, track, size, payment_verified, payment_ref)
         values ${values}
         on conflict (lower(name)) do update set
           college = coalesce(nullif(excluded.college, ''), teams.college),
           track = coalesce(nullif(excluded.track, ''), teams.track),
           size = greatest(teams.size, excluded.size),
           payment_verified = teams.payment_verified or excluded.payment_verified,
           payment_ref = coalesce(teams.payment_ref, excluded.payment_ref),
           updated_at = now()
         returning id, lower(name) as key`,
        chunk.flatMap((team) => [
          team.teamName,
          team.college,
          team.track,
          team.size,
          team.verified,
          team.paymentRef,
        ]),
      );
      for (const row of inserted) teamIds.set(row.key, row.id);
    }

    // 4. Upsert participants in chunks.
    let participantsAdded = 0;
    let participantsUpdated = 0;
    for (let i = 0; i < keep.length; i += 300) {
      const chunk = keep.slice(i, i + 300);
      const values = chunk
        .map((_, index) => {
          const base = index * 5;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        })
        .join(", ");
      const result = await q<{ inserted: boolean }>(
        `insert into participants (team_id, name, email, phone, is_leader)
         values ${values}
         on conflict (lower(email)) do update set
           name = excluded.name,
           phone = excluded.phone,
           team_id = excluded.team_id
         returning (xmax = 0) as inserted`,
        chunk.flatMap((row) => [
          teamIds.get(row.teamName.toLowerCase()) ?? null,
          row.name,
          row.email,
          row.phone,
          row.isLeader,
        ]),
      );
      for (const row of result) {
        if (row.inserted) participantsAdded += 1;
        else participantsUpdated += 1;
      }
    }

    await recordAudit({
      actor: session.label,
      role: "admin",
      action: "import.csv",
      entity: "teams",
      payload: {
        rows: rows.length,
        teams: teamList.length,
        participantsAdded,
        participantsUpdated,
        skipped,
      },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/teams");
    back("/admin/import", {
      ok: `${participantsAdded} added, ${participantsUpdated} updated across ${teamList.length} teams${
        skipped ? `, ${skipped} skipped (bad or duplicate email/phone)` : ""
      }`,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("import failed", error);
    back("/admin/import", {
      error: `Import failed: ${error instanceof Error ? error.message : "database error"}`,
    });
  }
}

// ----------------------------------------------------------------- payments
export async function togglePayment(formData: FormData) {
  const session = await requireAdmin();
  const teamId = String(formData.get("teamId") ?? "");
  const verified = String(formData.get("verified") ?? "") === "true";
  const paymentRef = String(formData.get("paymentRef") ?? "").trim() || null;
  if (!teamId) back("/admin/teams", { error: "Missing team" });

  const team = await one<{ id: string; name: string }>(
    `update teams set payment_verified = $2, payment_ref = coalesce($3, payment_ref), updated_at = now()
      where id = $1 returning id, name`,
    [teamId, verified, paymentRef],
  );
  if (!team) back("/admin/teams", { error: "Team not found" });

  await recordAudit({
    actor: session.label,
    role: "admin",
    action: verified ? "payment.verify" : "payment.unverify",
    entity: "team",
    entityId: team.id,
    payload: { name: team.name, paymentRef },
  });
  revalidatePath("/admin/teams");
  revalidatePath("/admin");
  back("/admin/teams", {
    ok: `${team.name} marked ${verified ? "payment verified" : "unverified"}`,
  });
}

// ------------------------------------------------------------------- staff
export async function addJudge(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  if (name.length < 2) back("/admin/staff", { error: "Judge name is required" });

  const judge = await one<{ id: string; invite_code: string }>(
    `insert into judges (name, email, invite_code) values ($1, $2, $3) returning id, invite_code`,
    [name.slice(0, 80), email, randomCode()],
  );
  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "judge.create",
    entity: "judge",
    entityId: judge?.id,
    payload: { name },
  });
  revalidatePath("/admin/staff");
  back("/admin/staff", { ok: `${name} added with code ${judge?.invite_code}` });
}

export async function addVolunteer(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) back("/admin/staff", { error: "Volunteer name is required" });

  const volunteer = await one<{ id: string; code: string }>(
    `insert into volunteers (name, code) values ($1, $2) returning id, code`,
    [name.slice(0, 80), randomCode()],
  );
  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "volunteer.create",
    entity: "volunteer",
    entityId: volunteer?.id,
    payload: { name },
  });
  revalidatePath("/admin/staff");
  back("/admin/staff", { ok: `${name} added with code ${volunteer?.code}` });
}

export async function setStaffActive(formData: FormData) {
  await requireAdmin();
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("/admin/staff", { error: "Missing staff id" });
  if (kind === "judge") {
    await q(`update judges set active = $2 where id = $1`, [id, active]);
  } else if (kind === "volunteer") {
    await q(`update volunteers set active = $2 where id = $1`, [id, active]);
  }
  revalidatePath("/admin/staff");
  back("/admin/staff", { ok: active ? "Activated" : "Deactivated" });
}

// -------------------------------------------------------------- assignments
type JudgeRow = { id: string; name: string; load: number };
type TeamRow = { id: string; name: string; assigned: number };

export async function autoAssign(formData: FormData) {
  const session = await requireAdmin();
  const perTeam = Math.max(1, Math.min(6, Number(formData.get("perTeam")) || 2));
  const round = String(formData.get("round") ?? "screening") === "final" ? "final" : "screening";

  const judges = await q<JudgeRow>(
    `select id, name, 0 as load from judges where active = true order by name`,
  );
  if (judges.length === 0) back("/admin/judging", { error: "Add at least one active judge first" });

  const teams = await q<TeamRow>(
    `select id, name, 0 as assigned from teams where payment_verified = true order by name`,
  );
  if (teams.length === 0) back("/admin/judging", { error: "No payment-verified teams to assign" });

  // Drop only unscored assignments — never destroy submitted score sheets.
  await q(
    `delete from assignments a
      where a.round = $1
        and not exists (select 1 from scores s where s.assignment_id = a.id)`,
    [round],
  );

  const existing = await q<{ judge_id: string; team_id: string }>(
    `select judge_id, team_id from assignments where round = $1`,
    [round],
  );
  const existingPairs = new Set(existing.map((row) => `${row.judge_id}:${row.team_id}`));

  const loadRows = await q<{ judge_id: string; count: string }>(
    `select judge_id, count(*)::text as count from assignments where round = $1 group by judge_id`,
    [round],
  );
  const loads = new Map(loadRows.map((row) => [row.judge_id, Number(row.count)]));
  for (const judge of judges) judge.load = loads.get(judge.id) ?? 0;

  const teamCounts = await q<{ team_id: string; count: string }>(
    `select team_id, count(*)::text as count from assignments where round = $1 group by team_id`,
    [round],
  );
  const counts = new Map(teamCounts.map((row) => [row.team_id, Number(row.count)]));
  for (const team of teams) team.assigned = counts.get(team.id) ?? 0;

  const conflicts = new Set(
    (await q<{ judge_id: string; team_id: string }>(`select judge_id, team_id from conflicts`)).map(
      (row) => `${row.judge_id}:${row.team_id}`,
    ),
  );

  const inserts: Array<[string, string]> = [];
  teams.sort((a, b) => a.assigned - b.assigned || a.name.localeCompare(b.name));

  for (const team of teams) {
    let needed = perTeam - team.assigned;
    if (needed <= 0) continue;
    const candidates = [...judges]
      .filter((judge) => {
        const key = `${judge.id}:${team.id}`;
        return !existingPairs.has(key) && !conflicts.has(key);
      })
      .sort((a, b) => a.load - b.load || Math.random() - 0.5);

    for (const judge of candidates) {
      if (needed <= 0) break;
      inserts.push([judge.id, team.id]);
      existingPairs.add(`${judge.id}:${team.id}`);
      judge.load += 1;
      needed -= 1;
    }
  }

  // Bulk insert in chunks: a 300-row run is two round trips.
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const values = chunk
      .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2}, '${round}')`)
      .join(", ");
    await q(
      `insert into assignments (judge_id, team_id, round) values ${values}
       on conflict (judge_id, team_id, round) do nothing`,
      chunk.flat(),
    );
  }

  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "assign.run",
    entity: "assignments",
    payload: { round, perTeam, created: inserts.length, teams: teams.length },
  });
  revalidatePath("/admin/judging");
  back("/admin/judging", { ok: `${inserts.length} ${round} assignments created` });
}

export async function createFinalistRound(formData: FormData) {
  const session = await requireAdmin();
  const config = await getConfig(true);
  const requested = Math.max(1, Math.min(30, Number(formData.get("count")) || config.judging.finalists));

  const rankings = (await computeRankings()).filter((team) => team.screening !== null);
  if (rankings.length === 0) back("/admin/results", { error: "No completed screening scores yet" });

  const finalists = rankings.slice(0, requested);
  const judges = await q<{ id: string }>(`select id from judges where active = true`);
  const conflicts = new Set(
    (await q<{ judge_id: string; team_id: string }>(`select judge_id, team_id from conflicts`)).map(
      (row) => `${row.judge_id}:${row.team_id}`,
    ),
  );

  const pairs: Array<[string, string]> = [];
  for (const team of finalists) {
    for (const judge of judges) {
      if (conflicts.has(`${judge.id}:${team.teamId}`)) continue;
      pairs.push([judge.id, team.teamId]);
    }
  }

  for (let i = 0; i < pairs.length; i += 200) {
    const chunk = pairs.slice(i, i + 200);
    const values = chunk
      .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2}, 'final')`)
      .join(", ");
    await q(
      `insert into assignments (judge_id, team_id, round) values ${values}
       on conflict (judge_id, team_id, round) do nothing`,
      chunk.flat(),
    );
  }

  await setConfig("judging", { ...config.judging, finalists: requested });
  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "assign.finalists",
    payload: { finalists: requested, assignments: pairs.length },
  });
  revalidatePath("/admin/results");
  revalidatePath("/admin/judging");
  back("/admin/results", {
    ok: `${finalists.length} finalists assigned to ${judges.length} judges`,
  });
}

export async function saveConflicts(formData: FormData) {
  await requireAdmin();
  const judgeId = String(formData.get("judgeId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!judgeId || !teamId) back("/admin/judging", { error: "Pick a judge and a team" });
  await q(
    `insert into conflicts (judge_id, team_id, reason) values ($1, $2, $3)
     on conflict (judge_id, team_id) do update set reason = excluded.reason`,
    [judgeId, teamId, reason],
  );
  revalidatePath("/admin/judging");
  back("/admin/judging", { ok: "Conflict recorded" });
}

export async function removeConflict(formData: FormData) {
  await requireAdmin();
  const judgeId = String(formData.get("judgeId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  await q(`delete from conflicts where judge_id = $1 and team_id = $2`, [judgeId, teamId]);
  revalidatePath("/admin/judging");
  back("/admin/judging", { ok: "Conflict removed" });
}

// ----------------------------------------------------------------- results
export async function publishResults(formData: FormData) {
  const session = await requireAdmin();
  const publish = String(formData.get("publish") ?? "") === "true";
  await getConfig(true);

  if (!publish) {
    await q(`update results set published = false`);
    await setConfig("publish", { published: false, published_at: null });
    await recordAudit({ actor: session.label, role: "admin", action: "results.unpublish" });
    revalidatePath("/results");
    revalidatePath("/admin/results");
    back("/admin/results", { ok: "Results unpublished" });
  }

  const rankings = await computeRankings();
  const scored = rankings.filter((team) => team.screening !== null || team.final !== null);
  if (scored.length === 0) back("/admin/results", { error: "Nothing to publish — no scores yet" });

  for (const team of scored) {
    await q(
      `insert into results (team_id, screening_total, final_total, rank, published, computed_at)
       values ($1, $2, $3, $4, true, now())
       on conflict (team_id) do update set
         screening_total = excluded.screening_total,
         final_total = excluded.final_total,
         rank = excluded.rank,
         published = true,
         computed_at = now()`,
      [team.teamId, team.screening, team.final, team.rank],
    );
  }
  await q(`update results set published = false where team_id <> all($1::uuid[])`, [
    scored.map((team) => team.teamId),
  ]);

  const publishedAt = new Date().toISOString();
  await setConfig("publish", { published: true, published_at: publishedAt });
  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "results.publish",
    entity: "results",
    payload: { teams: scored.length, publishedAt },
  });
  revalidatePath("/results");
  revalidatePath("/admin/results");
  back("/admin/results", { ok: `Published ${scored.length} ranked teams` });
}

// -------------------------------------------------------- repo check helper
export async function recheckRepo(formData: FormData) {
  await requireAdmin();
  const teamId = String(formData.get("teamId") ?? "");
  const submission = await one<{ repo_url: string }>(
    `select repo_url from submissions where team_id = $1`,
    [teamId],
  );
  if (!submission) back("/admin/results", { error: "No submission for that team" });

  const inspection = await inspectRepo(submission.repo_url);
  await q(
    `update submissions set repo_public = $2, first_commit_at = $3, updated_at = now()
      where team_id = $1`,
    [teamId, inspection.repoPublic, inspection.firstCommitAt],
  );
  revalidatePath("/admin/results");
  back("/admin/results", { ok: inspection.error ?? "Repository rechecked" });
}

export async function updateEventConfig(formData: FormData) {
  await requireAdmin();
  const config = await getConfig(true);
  const deadline = String(formData.get("submission_deadline") ?? "").trim();
  if (deadline) {
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) back("/admin/results", { error: "Invalid deadline" });
    await setConfig("event", { ...config.event, submission_deadline: parsed.toISOString() });
  }
  const weights = Number(formData.get("final_weight"));
  if (Number.isFinite(weights) && weights > 0 && weights < 1) {
    await setConfig("judging", {
      ...config.judging,
      final_weight: weights,
      screening_weight: Math.round((1 - weights) * 100) / 100,
    });
  }
  revalidatePath("/admin/results");
  back("/admin/results", { ok: "Configuration saved" });
}

// ------------------------------------------------------------- repo tracker
export async function syncRepoNow(formData: FormData) {
  const session = await requireAdmin();
  const teamId = String(formData.get("teamId") ?? "");
  const result = await syncTeamRepo(teamId);

  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "repo.sync",
    entity: "team",
    entityId: teamId,
    payload: { ok: result.ok, commits: result.commits, error: result.error },
  });

  revalidatePath("/admin/repos");
  revalidatePath("/admin/results");
  if (!result.ok) back("/admin/repos", { error: result.error ?? "Repository sync failed" });
  back("/admin/repos", {
    ok: `${result.team}: ${result.commits} commit${result.commits === 1 ? "" : "s"} tracked`,
  });
}

export async function syncReposNow(formData: FormData) {
  const session = await requireAdmin();
  const requested = Number(formData.get("limit") ?? 15);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 60) : 15;

  const summary = await syncRepoBatch(limit);
  await recordAudit({
    actor: session.label,
    role: "admin",
    action: "repo.sync.batch",
    payload: {
      checked: summary.checked,
      ok: summary.ok,
      failed: summary.failed,
      commits: summary.commits,
      stopped: summary.stopped,
      remaining: summary.rateLimit.remaining,
    },
  });

  revalidatePath("/admin/repos");
  revalidatePath("/admin/results");

  const message = `Synced ${summary.ok}/${summary.checked} repositories · ${summary.commits} commits`;
  if (summary.failed > 0) {
    back("/admin/repos", {
      ok: message,
      error: `${summary.failed} failed${summary.stopped ? " · stopped early on GitHub rate limit" : ""}`,
    });
  }
  back("/admin/repos", { ok: message });
}
