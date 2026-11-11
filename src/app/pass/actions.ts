"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { one, q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { verifyTeamToken } from "@/lib/crypto";
import { inspectRepo } from "@/lib/github";
import { recordAudit } from "@/lib/api";
import { passCache } from "@/lib/pass-cache";

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export async function submitProject(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const teamId = await verifyTeamToken(token);
  if (!teamId) redirect("/");

  const team = await one<{ name: string }>(`select name from teams where id = $1`, [teamId]);
  if (!team) redirect("/");

  const back = `/pass/${token}`;
  const config = await getConfig(true);

  if (Date.now() > new Date(config.event.submission_deadline).getTime()) {
    redirect(`${back}?error=${encodeURIComponent("Submissions closed at the 17:30 deadline")}`);
  }

  const repoUrl = String(formData.get("repo_url") ?? "").trim();
  const videoUrl = String(formData.get("video_url") ?? "").trim() || null;
  const slidesUrl = String(formData.get("slides_url") ?? "").trim() || null;
  const track = String(formData.get("track") ?? "").trim() || null;

  if (!URL_PATTERN.test(repoUrl)) {
    redirect(`${back}?error=${encodeURIComponent("Repository must be a full https:// URL")}`);
  }
  for (const [label, value] of [
    ["Demo video", videoUrl],
    ["Slides", slidesUrl],
  ] as const) {
    if (value && !URL_PATTERN.test(value)) {
      redirect(`${back}?error=${encodeURIComponent(`${label} must be a full https:// URL`)}`);
    }
  }

  const inspection = await inspectRepo(repoUrl);
  const commitFlag =
    inspection.firstCommitAt && new Date(inspection.firstCommitAt) < new Date(config.event.hack_start)
      ? "first commit before 09:40 kickoff"
      : inspection.error;

  await q(
    `insert into submissions (team_id, repo_url, video_url, slides_url, track, first_commit_at,
                              repo_public, commit_flag, submitted_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     on conflict (team_id) do update set
       repo_url = excluded.repo_url,
       video_url = excluded.video_url,
       slides_url = excluded.slides_url,
       track = excluded.track,
       first_commit_at = excluded.first_commit_at,
       repo_public = excluded.repo_public,
       commit_flag = excluded.commit_flag,
       updated_at = now()`,
    [
      teamId,
      repoUrl,
      videoUrl,
      slidesUrl,
      track,
      inspection.firstCommitAt,
      inspection.repoPublic,
      commitFlag,
    ],
  );

  if (track) {
    await q(`update teams set track = $2, updated_at = now() where id = $1`, [teamId, track]);
  }

  await recordAudit({
    actor: team.name,
    role: "participant",
    action: "submission.save",
    entity: "team",
    entityId: teamId,
    payload: { repoUrl, repoPublic: inspection.repoPublic, commitFlag },
  });

  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Submission saved")}`);
}

/**
 * Self check-in: the pass link is the credential, so a participant can mark the
 * team lead present without a volunteer. Only the lead is ever written, and the
 * update is a no-op once that lead has a check-in timestamp.
 */
export async function checkInTeam(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const teamId = await verifyTeamToken(token);
  if (!teamId) redirect("/");

  const back = `/pass/${token}`;

  const row = await one<{
    team: string;
    lead: string | null;
    checked_in_at: string | null;
    changed: number;
  }>(
    `with lead as (
       select p.id, p.team_id, p.name, p.checked_in_at
         from participants p
        where p.team_id = $1
        order by p.is_leader desc, p.created_at, p.name
        limit 1
     ),
     updated as (
       update participants p set checked_in_at = now()
         from lead
        where p.id = lead.id and p.checked_in_at is null
        returning p.id, p.checked_in_at
     )
     select t.name as team, lead.name as lead,
            coalesce((select checked_in_at from updated), lead.checked_in_at) as checked_in_at,
            (select count(*) from updated)::int as changed
       from lead join teams t on t.id = lead.team_id`,
    [teamId],
  );

  if (!row) {
    redirect(`${back}?error=${encodeURIComponent("This team has no registered members yet")}`);
  }

  passCache.clear();
  revalidatePath(back);

  await recordAudit({
    actor: "self-service",
    role: "participant",
    action: row.changed > 0 ? "checkin.self" : "checkin.self.repeat",
    entity: "team",
    entityId: teamId,
    payload: { team: row.team, lead: row.lead },
  });

  const message =
    row.changed > 0
      ? `${row.lead ?? "Team lead"} checked in`
      : `${row.lead ?? "Team lead"} was already checked in`;
  redirect(`${back}?ok=${encodeURIComponent(message)}`);
}
