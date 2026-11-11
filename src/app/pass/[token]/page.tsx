import Link from "next/link";
import { one, q } from "@/lib/db";
import { verifyQrToken } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { fmtDateTime, fmtScore, fmtTime } from "@/lib/format";
import { baseUrl } from "@/lib/site";
import QrPass from "@/components/QrPass";
import Flash from "@/components/Flash";
import { submitProject } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your pass" };

const TRACKS = ["AI/ML", "Web3", "HealthTech", "EdTech", "Sustainability", "Open Innovation"];

export default async function PassPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { token } = await params;
  const { ok, error } = await searchParams;

  const participantId = await verifyQrToken(token);
  if (!participantId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card-pad max-w-md text-center">
          <p className="text-3xl">🚫</p>
          <h1 className="mt-3 text-xl font-bold text-ink-900">This pass link is not valid</h1>
          <p className="mt-2 text-sm text-ink-600">
            The link or QR code was mistyped or belongs to another event. Ask the tech desk to resend
            your pass.
          </p>
          <Link href="/" className="btn-secondary mt-4">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const participant = await one<{
    id: string;
    name: string;
    email: string;
    checked_in_at: string | null;
    team_id: string;
    team_name: string;
    college: string | null;
    track: string | null;
  }>(
    `select p.id, p.name, p.email, p.checked_in_at, p.team_id,
            t.name as team_name, t.college, t.track
       from participants p join teams t on t.id = p.team_id
      where p.id = $1`,
    [participantId],
  );

  if (!participant) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card-pad max-w-md text-center text-sm text-ink-600">
          This participant record no longer exists.
        </div>
      </main>
    );
  }

  // The QR carries the absolute pass link, not the raw token, so any phone
  // camera (or printed sheet) opens the pass instead of showing a hex string.
  const origin = await baseUrl();
  const passUrl = `${origin}/pass/${token}`;

  const config = await getConfig();
  const deadline = new Date(config.event.submission_deadline);
  const open = Date.now() <= deadline.getTime();

  const [submission, scores, results] = await Promise.all([
    one<{
      repo_url: string;
      video_url: string | null;
      slides_url: string | null;
      track: string | null;
      first_commit_at: string | null;
      repo_public: boolean | null;
      submitted_at: string;
    }>(`select repo_url, video_url, slides_url, track, first_commit_at, repo_public, submitted_at
          from submissions where team_id = $1`, [participant.team_id]),
    config.publish.published
      ? q<{ label: string; weight: number; average: number; judges: number }>(
          `select r.label, r.weight, round(avg(s.score), 2)::float as average, count(distinct a.judge_id)::int as judges
             from scores s
             join assignments a on a.id = s.assignment_id
             join rubric r on r.key = s.rubric_key
            where a.team_id = $1 and a.round = 'screening'
            group by r.key, r.label, r.weight, r.sort
            order by r.sort`,
          [participant.team_id],
        )
      : Promise.resolve([]),
    config.publish.published
      ? one<{ rank: number; screening_total: number | null; final_total: number | null }>(
          `select rank, screening_total::float, final_total::float from results
            where team_id = $1 and published = true`,
          [participant.team_id],
        )
      : Promise.resolve(null),
  ]);

  const totalWeight = scores.reduce((sum, row) => sum + row.weight, 0) || 1;
  const weightedTotal = scores.reduce((sum, row) => sum + (row.average / 10) * row.weight, 0);

  return (
    <main className="min-h-screen bg-ink-50 pb-12">
      <header className="border-b border-ink-200 bg-white">
        <div className="container-page flex h-14 items-center justify-between">
          <span className="text-sm font-bold text-ink-900">⚡ {config.event.name}</span>
          <Link href="/results" className="text-xs font-semibold text-spark-700">
            Results
          </Link>
        </div>
      </header>

      <div className="container-page mt-5 max-w-3xl space-y-5">
        <Flash ok={ok} error={error} />

        <section className="card-pad">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-spark-700">
                Participant pass
              </p>
              <h1 className="mt-1 text-2xl font-bold text-ink-900">{participant.name}</h1>
              <p className="text-sm text-ink-600">
                {participant.team_name}
                {participant.college ? ` · ${participant.college}` : ""}
              </p>
              <p className="mt-1 text-xs text-ink-500">{participant.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {participant.checked_in_at ? (
                  <span className="badge-ok">Checked in {fmtTime(participant.checked_in_at)}</span>
                ) : (
                  <span className="badge-warn">Not checked in yet</span>
                )}
                {participant.track ? <span className="badge-info">{participant.track}</span> : null}
              </div>
            </div>
            <div className="text-center">
              <QrPass value={passUrl} size={150} className="rounded-xl ring-1 ring-ink-200" />
              <p className="mt-1.5 font-mono text-[10px] text-ink-400">Show this at the desk</p>
            </div>
          </div>
          <p className="mt-4 rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
            Keep this page open on your phone for check-in and meals. Each meal can be scanned once
            per person. Printed passes are available at the tech desk if your phone dies.
          </p>
        </section>

        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Submission</h2>
          {submission ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                <span className="text-ink-500">Repository: </span>
                <a href={submission.repo_url} target="_blank" rel="noreferrer" className="link break-all">
                  {submission.repo_url}
                </a>
                {submission.repo_public === false ? (
                  <span className="ml-2 badge-bad">Not public</span>
                ) : null}
              </p>
              {submission.video_url ? (
                <p>
                  <span className="text-ink-500">Demo video: </span>
                  <a href={submission.video_url} target="_blank" rel="noreferrer" className="link break-all">
                    link
                  </a>
                </p>
              ) : null}
              {submission.slides_url ? (
                <p>
                  <span className="text-ink-500">Slides: </span>
                  <a href={submission.slides_url} target="_blank" rel="noreferrer" className="link break-all">
                    link
                  </a>
                </p>
              ) : null}
              <p className="text-xs text-ink-500">
                Saved {fmtDateTime(submission.submitted_at)} · you can update it until the cutoff.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Nothing submitted yet. All three links are checked by a human — the repo must be
              public.
            </p>
          )}

          {open ? (
            <form action={submitProject} className="mt-4 space-y-3">
              <input type="hidden" name="token" value={token} />
              <div>
                <label htmlFor="repo_url" className="label">
                  GitHub repository (public) *
                </label>
                <input
                  id="repo_url"
                  name="repo_url"
                  required
                  defaultValue={submission?.repo_url ?? ""}
                  className="input"
                  placeholder="https://github.com/team/project"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="video_url" className="label">
                    Demo video link
                  </label>
                  <input
                    id="video_url"
                    name="video_url"
                    defaultValue={submission?.video_url ?? ""}
                    className="input"
                    placeholder="https://youtu.be/…"
                  />
                </div>
                <div>
                  <label htmlFor="slides_url" className="label">
                    Slides link
                  </label>
                  <input
                    id="slides_url"
                    name="slides_url"
                    defaultValue={submission?.slides_url ?? ""}
                    className="input"
                    placeholder="https://drive.google.com/…"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="track" className="label">
                  Track
                </label>
                <select id="track" name="track" defaultValue={submission?.track ?? participant.track ?? ""} className="input">
                  <option value="">Select track</option>
                  {TRACKS.map((track) => (
                    <option key={track} value={track}>
                      {track}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn-primary">
                {submission ? "Update submission" : "Submit project"}
              </button>
            </form>
          ) : (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Submissions closed at {fmtTime(config.event.submission_deadline)}. Talk to the tech desk
              if you have an emergency.
            </p>
          )}
        </section>

        <section className="card-pad">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Your schedule</h2>
            <span className="text-xs text-ink-500">{fmtDateTime(config.event.starts_at)}</span>
          </div>
          <ol className="mt-3 space-y-2 text-sm">
            {[
              ["08:30", "Check-in and breakfast"],
              ["09:40", "Hacking starts"],
              ["13:00", "Lunch"],
              ["16:30", "Snacks"],
              ["17:30", "Submission cutoff"],
              ["18:15", "Finalists announced"],
              ["19:30", "Dinner"],
              ["20:50", "Winners announced"],
            ].map(([time, label]) => (
              <li key={time} className="flex gap-3">
                <span className="w-14 font-mono text-xs font-semibold text-spark-700">{time}</span>
                <span className="text-ink-700">{label}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Rules</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li>• Code must start at 09:40 — the first commit on your default branch is checked.</li>
            <li>• The submitted repository must be public at submission time.</li>
            <li>• Declare all AI assistance to judges during your demo; undisclosed use is a rules issue.</li>
            <li>• One meal serving per person per meal, tracked by your pass.</li>
            <li>• Judges with a conflict of interest are excluded from your team&apos;s panel.</li>
          </ul>
        </section>

        {config.publish.published ? (
          <section className="card-pad">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Your scores</h2>
            {results ? (
              <>
                <p className="mt-2 text-sm text-ink-600">
                  Rank <strong className="text-ink-900">#{results.rank}</strong>
                  {results.final_total !== null
                    ? ` · finalist round ${fmtScore(results.final_total)}`
                    : results.screening_total !== null
                      ? ` · screening ${fmtScore(results.screening_total)}`
                      : ""}
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Criterion</th>
                        <th className="text-right">Weight</th>
                        <th className="text-right">Average</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scores.map((row) => (
                        <tr key={row.label}>
                          <td className="text-ink-800">{row.label}</td>
                          <td className="text-right font-mono tabular-nums">{row.weight}%</td>
                          <td className="text-right font-mono tabular-nums">
                            {fmtScore(row.average)} / 10
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Weighted total {(weightedTotal * (100 / totalWeight)).toFixed(2)} / 100.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-600">
                Results are published, but this team has no completed score sheet. Contact the tech
                desk.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
