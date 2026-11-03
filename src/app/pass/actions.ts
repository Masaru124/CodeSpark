"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { one, q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { verifyQrToken } from "@/lib/crypto";
import { inspectRepo } from "@/lib/github";
import { recordAudit } from "@/lib/api";

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export async function submitProject(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const participantId = await verifyQrToken(token);
  if (!participantId) redirect("/");

  const participant = await one<{ team_id: string; name: string }>(
    `select team_id, name from participants where id = $1`,
    [participantId],
  );
  if (!participant) redirect("/");

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
      participant.team_id,
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
    await q(`update teams set track = $2, updated_at = now() where id = $1`, [
      participant.team_id,
      track,
    ]);
  }

  await recordAudit({
    actor: participant.name,
    role: "participant",
    action: "submission.save",
    entity: "team",
    entityId: participant.team_id,
    payload: { repoUrl, repoPublic: inspection.repoPublic, commitFlag },
  });

  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Submission saved")}`);
}
