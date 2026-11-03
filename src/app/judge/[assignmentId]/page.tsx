import Link from "next/link";
import { notFound } from "next/navigation";
import { one, q } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getRubric } from "@/lib/judging";
import { fmtDateTime } from "@/lib/format";
import ScoreForm from "./ScoreForm";

export const dynamic = "force-dynamic";

export default async function ScorePage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const session = await getSession();
  if (!session?.subjectId) notFound();

  const assignment = await one<{
    id: string;
    round: string;
    team_name: string;
    college: string | null;
    track: string | null;
    repo_url: string | null;
    video_url: string | null;
    slides_url: string | null;
    first_commit_at: string | null;
  }>(
    `select a.id, a.round, t.name as team_name, t.college, t.track,
            s.repo_url, s.video_url, s.slides_url, s.first_commit_at
       from assignments a
       join teams t on t.id = a.team_id
       left join submissions s on s.team_id = t.id
      where a.id = $1 and a.judge_id = $2`,
    [assignmentId, session.subjectId],
  );

  if (!assignment) notFound();

  const [rubric, scores] = await Promise.all([
    getRubric(),
    q<{ rubric_key: string; score: string; comment: string | null }>(
      `select rubric_key, score::text, comment from scores where assignment_id = $1`,
      [assignment.id],
    ),
  ]);

  const initial: Record<string, number> = {};
  for (const row of scores) initial[row.rubric_key] = Number(row.score);
  const comment = scores.find((row) => row.comment)?.comment ?? "";
  const complete = scores.length >= rubric.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/judge" className="text-xs font-semibold text-spark-700">
          ← All my teams
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <span className="badge-info">{assignment.round === "final" ? "Finalist round" : "Screening"}</span>
          {complete ? <span className="badge-ok">Sheet complete</span> : <span className="badge-warn">Incomplete</span>}
        </div>
      </div>

      <div className="card-pad">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {assignment.college ?? "—"}
          {assignment.track ? ` · ${assignment.track}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900">{assignment.team_name}</h1>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {assignment.repo_url ? (
            <a href={assignment.repo_url} target="_blank" rel="noreferrer" className="link break-all">
              Repository
            </a>
          ) : (
            <span className="text-ink-500">No repository submitted</span>
          )}
          {assignment.video_url ? (
            <a href={assignment.video_url} target="_blank" rel="noreferrer" className="link">
              Demo video
            </a>
          ) : null}
          {assignment.slides_url ? (
            <a href={assignment.slides_url} target="_blank" rel="noreferrer" className="link">
              Slides
            </a>
          ) : null}
        </div>
        {assignment.first_commit_at ? (
          <p
            className={`mt-2 text-xs ${
              new Date(assignment.first_commit_at) < new Date("2026-11-12T09:40:00+05:30")
                ? "font-semibold text-amber-700"
                : "text-ink-500"
            }`}
          >
            First commit {fmtDateTime(assignment.first_commit_at)}
            {new Date(assignment.first_commit_at) < new Date("2026-11-12T09:40:00+05:30")
              ? " — earlier than kickoff, flag it to the tech desk"
              : ""}
          </p>
        ) : null}
      </div>

      <ScoreForm
        assignmentId={assignment.id}
        teamName={assignment.team_name}
        criteria={rubric.map((criterion) => ({
          key: criterion.key,
          label: criterion.label,
          weight: criterion.weight,
          max_score: criterion.max_score,
        }))}
        initial={initial}
        initialComment={comment}
      />
    </div>
  );
}
