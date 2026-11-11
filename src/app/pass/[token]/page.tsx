import { one } from "@/lib/db";
import { verifyTeamToken } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { fmtDateTime, fmtScore, fmtTime } from "@/lib/format";
import { baseUrl } from "@/lib/site";
import QrPass from "@/components/QrPass";
import Flash from "@/components/Flash";
import Link from "next/link";
import { submitProject, checkInTeam } from "../actions";
import { getSession } from "@/lib/session";
import { passCache } from "@/lib/pass-cache";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team pass" };

const TRACKS = ["AI/ML", "Web3", "HealthTech", "EdTech", "Sustainability", "Open Innovation"];

type TeamPassRow = {
  id: string;
  name: string;
  college: string | null;
  track: string | null;
  payment_verified: boolean;
  total: number;
  checked_in: number;
  members: Array<{ id: string; name: string; is_leader: boolean; checked_in_at: string | null }>;
  submission: {
    repo_url: string;
    video_url: string | null;
    slides_url: string | null;
    track: string | null;
    first_commit_at: string | null;
    repo_public: boolean | null;
    submitted_at: string;
  } | null;
  scores: Array<{ label: string; weight: number; average: number; judges: number }> | null;
  results: { rank: number; screening_total: number | null; final_total: number | null } | null;
};

// A team's pass is opened by several members at once; cache the assembled row
// for a few seconds so a group arrival is one database read, not four. The
// check-in badge is at most 5 s behind, which is well inside scanning latency.

export default async function PassPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { token } = await params;
  const { ok, error } = await searchParams;

  const teamId = await verifyTeamToken(token);
  if (!teamId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card-pad max-w-md text-center">
          <p className="text-3xl">🚫</p>
          <h1 className="mt-3 text-xl font-bold text-ink-900">This team pass is not valid</h1>
          <p className="mt-2 text-sm text-ink-600">
            The link or QR code was mistyped or belongs to another event. Ask the tech desk to
            reprint your team pass.
          </p>
          <Link href="/" className="btn-secondary mt-4">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const config = await getConfig();
  const deadline = new Date(config.event.submission_deadline);
  const open = Date.now() <= deadline.getTime();

  // One round trip for the whole page: team, members, submission and, when
  // published, the score rows. Previously this page made four sequential calls.
  const team = (await passCache.get(
    `${teamId}:${config.publish.published}`,
    () =>
      one<{
    id: string;
    name: string;
    college: string | null;
    track: string | null;
    payment_verified: boolean;
    total: number;
    checked_in: number;
    members: Array<{ id: string; name: string; is_leader: boolean; checked_in_at: string | null }>;
    submission: {
      repo_url: string;
      video_url: string | null;
      slides_url: string | null;
      track: string | null;
      first_commit_at: string | null;
      repo_public: boolean | null;
      submitted_at: string;
    } | null;
    scores: Array<{ label: string; weight: number; average: number; judges: number }> | null;
    results: { rank: number; screening_total: number | null; final_total: number | null } | null;
  }>(
    `select t.id, t.name, t.college, t.track, t.payment_verified,
            count(p.id)::int as total,
            count(p.checked_in_at)::int as checked_in,
            coalesce(json_agg(json_build_object(
              'id', p.id, 'name', p.name, 'is_leader', p.is_leader,
              'checked_in_at', p.checked_in_at
            ) order by p.is_leader desc, p.name) filter (where p.id is not null), '[]'::json) as members,
            (select json_build_object(
               'repo_url', s.repo_url, 'video_url', s.video_url, 'slides_url', s.slides_url,
               'track', s.track, 'first_commit_at', s.first_commit_at,
               'repo_public', s.repo_public, 'submitted_at', s.submitted_at)
               from submissions s where s.team_id = t.id) as submission,
            case when $2::boolean then (
              select json_agg(row_to_json(sc)) from (
                select r.label, r.weight, round(avg(s2.score), 2)::float as average,
                       count(distinct a.judge_id)::int as judges
                  from scores s2
                  join assignments a on a.id = s2.assignment_id
                  join rubric r on r.key = s2.rubric_key
                 where a.team_id = t.id and a.round = 'screening'
                 group by r.key, r.label, r.weight, r.sort
                 order by r.sort
              ) sc
            ) else null end as scores,
            case when $2::boolean then (
              select json_build_object('rank', res.rank,
                                       'screening_total', res.screening_total::float,
                                       'final_total', res.final_total::float)
                from results res where res.team_id = t.id and res.published = true
            ) else null end as results
       from teams t
       left join participants p on p.team_id = t.id
      where t.id = $1
      group by t.id`,
        [teamId, config.publish.published],
      ),
  )) as TeamPassRow | null;

  if (!team) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card-pad max-w-md text-center text-sm text-ink-600">
          This team record no longer exists.
        </div>
      </main>
    );
  }

  const members = team.members ?? [];
  const lead = members.find((member) => member.is_leader) ?? members[0] ?? null;
  const submission = team.submission;
  const scores = team.scores ?? [];
  const results = team.results;

  // The QR carries the absolute pass link, not the raw token, so any phone
  // camera (or printed sheet) opens the pass instead of showing a hex string.
  const origin = await baseUrl();
  const passUrl = `${origin}/pass/${token}`;

  const totalWeight = scores.reduce((sum, row) => sum + row.weight, 0) || 1;
  const weightedTotal = scores.reduce((sum, row) => sum + (row.average / 10) * row.weight, 0);
  const session = await getSession();

  return (
    <main className="min-h-screen bg-ink-50 pb-12">
      <header className="border-b border-ink-200 bg-white">
        <div className="container-page flex h-14 items-center justify-between">
          <span className="text-sm font-bold text-ink-900">⚡ {config.event.name}</span>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link href="/results" className="text-spark-700">
              Results
            </Link>
            {session?.role === "admin" ? (
              <Link href={`/admin/teams/${team.id}`} className="text-ink-500">
                Manage
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="container-page mt-5 max-w-3xl space-y-5">
        <Flash ok={ok} error={error} />

        <section className="card-pad">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-spark-700">
                Team pass · one QR per team
              </p>
              <h1 className="mt-1 text-2xl font-bold text-ink-900">{team.name}</h1>
              <p className="text-sm text-ink-600">
                {team.college ?? "—"}
                {team.track ? ` · ${team.track}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {lead?.checked_in_at ? (
                  <span className="badge-ok">
                    Team lead checked in {fmtTime(lead.checked_in_at)}
                  </span>
                ) : (
                  <span className="badge-warn">Team lead not checked in yet</span>
                )}
                <span className="badge-neutral">{team.total} members</span>
                {team.payment_verified ? null : <span className="badge-warn">Payment pending</span>}
              </div>
              {lead?.checked_in_at ? null : (
                <form action={checkInTeam} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="token" value={token} />
                  <button type="submit" className="btn-primary text-sm">
                    Check in my team
                  </button>
                  <span className="text-xs text-ink-500">Marks the team lead present — no volunteer needed</span>
                </form>
              )}
            </div>
            <div className="text-center">
              <QrPass value={passUrl} size={170} className="rounded-xl ring-1 ring-ink-200" />
              <p className="mt-1.5 font-mono text-[10px] text-ink-400">Scan or tap to check in</p>
            </div>
          </div>
          <p className="mt-4 rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
            Tap <strong className="text-ink-700">Check in my team</strong> (or let a volunteer scan
            it) to mark the team lead present. One check-in per team — meals are not scanned at this
            event. Printed passes are available at the tech desk if your phone dies.
          </p>
        </section>

        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Team members</h2>
          <ul className="mt-3 divide-y divide-ink-100 text-sm">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-800">
                  {member.name}
                  {member.is_leader ? <span className="ml-2 badge-info">Lead</span> : null}
                </span>
                <span className={member.checked_in_at ? "text-xs text-emerald-700" : "text-xs text-ink-400"}>
                  {member.checked_in_at ? `In at ${fmtTime(member.checked_in_at)}` : "Not checked in"}
                </span>
              </li>
            ))}
            {members.length === 0 ? (
              <li className="py-2 text-ink-500">No members imported for this team yet.</li>
            ) : null}
          </ul>
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
                <select
                  id="track"
                  name="track"
                  defaultValue={submission?.track ?? team.track ?? ""}
                  className="input"
                >
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
            <li>• The team QR checks in the team lead; only the lead is marked present.</li>
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
                  Screening weighted total {(weightedTotal * (100 / totalWeight)).toFixed(2)} / 100.
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
