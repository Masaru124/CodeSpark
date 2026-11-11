import Flash from "@/components/Flash";
import { q } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { findOutliers, judgingProgress } from "@/lib/judging";
import { autoAssign, manualAssign, removeAssignment, removeConflict, saveConflicts } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judging" };

type JudgeLoad = {
  id: string;
  name: string;
  active: boolean;
  screening: number;
  screening_done: number;
  final: number;
  final_done: number;
};

export default async function JudgingPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const config = await getConfig();

  const [judges, progress, outliers, conflicts, teams, assignments] = await Promise.all([
    q<JudgeLoad>(
      `select j.id, j.name, j.active,
              count(a.id) filter (where a.round = 'screening')::int as screening,
              count(a.id) filter (where a.round = 'screening' and sub.criteria >= 4)::int as screening_done,
              count(a.id) filter (where a.round = 'final')::int as final,
              count(a.id) filter (where a.round = 'final' and sub.criteria >= 4)::int as final_done
         from judges j
         left join assignments a on a.judge_id = j.id
         left join lateral (
           select count(distinct s.rubric_key) as criteria from scores s where s.assignment_id = a.id
         ) sub on true
        group by j.id, j.name, j.active
        order by j.active desc, j.name`,
    ),
    judgingProgress(),
    findOutliers(config.judging.outlier_threshold),
    q<{ judge_id: string; team_id: string; judge_name: string; team_name: string; reason: string | null }>(
      `select c.judge_id, c.team_id, j.name as judge_name, t.name as team_name, c.reason
         from conflicts c join judges j on j.id = c.judge_id join teams t on t.id = c.team_id
        order by j.name, t.name`,
    ),
    q<{ id: string; name: string }>(`select id, name from teams order by name`),
    q<{ id: string; round: string; judge_name: string; team_name: string; scores: number }>(
      `select a.id, a.round, j.name as judge_name, t.name as team_name,
              (select count(*) from scores s where s.assignment_id = a.id)::int as scores
         from assignments a
         join judges j on j.id = a.judge_id
         join teams t on t.id = a.team_id
        order by a.round, t.name, j.name
        limit 400`,
    ),
  ]);

  const byTeam = new Map<
    string,
    { name: string; screening: { judges: number; complete: number }; final: { judges: number; complete: number } }
  >();
  for (const row of progress) {
    const entry =
      byTeam.get(row.teamId) ??
      { name: row.name, screening: { judges: 0, complete: 0 }, final: { judges: 0, complete: 0 } };
    if (row.round === "final") entry.final = { judges: row.judges, complete: row.complete };
    else entry.screening = { judges: row.judges, complete: row.complete };
    byTeam.set(row.teamId, entry);
  }
  const teamRows = [...byTeam.values()].sort((a, b) => a.name.localeCompare(b.name));
  const screeningAssigned = teamRows.reduce((sum, row) => sum + row.screening.judges, 0);
  const screeningComplete = teamRows.reduce((sum, row) => sum + row.screening.complete, 0);

  return (
    <div className="space-y-7">
      <Flash ok={ok} error={error} />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Judging</h1>
        <p className="mt-1 text-sm text-ink-600">
          {screeningComplete}/{screeningAssigned} screening sheets complete across {teamRows.length}{" "}
          teams · outliers flagged beyond ±{config.judging.outlier_threshold} points.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <form action={autoAssign} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Auto-assign judges</h2>
          <p className="text-xs text-ink-500">
            Balanced round-robin over payment-verified teams, skipping declared conflicts. Existing
            submitted score sheets are never deleted.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="perTeam" className="label">
                Judges per team
              </label>
              <input
                id="perTeam"
                name="perTeam"
                type="number"
                min={1}
                max={6}
                defaultValue={2}
                className="input"
              />
            </div>
            <div>
              <label htmlFor="round" className="label">
                Round
              </label>
              <select id="round" name="round" className="input" defaultValue="screening">
                <option value="screening">Screening</option>
                <option value="final">Finalist</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn-primary w-full">
            Run assignment
          </button>
        </form>

        <section className="card-pad">
          <h2 className="text-sm font-bold text-ink-900">Judge load</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Judge</th>
                  <th className="text-right">Screening</th>
                  <th className="text-right">Finalist</th>
                </tr>
              </thead>
              <tbody>
                {judges.map((judge) => (
                  <tr key={judge.id}>
                    <td>
                      <span className="font-semibold text-ink-900">{judge.name}</span>
                      {judge.active ? null : <span className="ml-2 badge-neutral">Disabled</span>}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {judge.screening_done}/{judge.screening}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {judge.final_done}/{judge.final}
                    </td>
                  </tr>
                ))}
                {judges.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-ink-500">
                      No judges yet — add them under Judges &amp; volunteers.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <form action={manualAssign} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Assign a judge manually</h2>
          <p className="text-xs text-ink-500">
            Pick one judge, one team and the phase. Conflicting judges are refused; an existing
            assignment is left untouched.
          </p>
          <div>
            <label htmlFor="manualJudge" className="label">
              Judge
            </label>
            <select id="manualJudge" name="judgeId" className="input" required>
              <option value="">Select judge</option>
              {judges.map((judge) => (
                <option key={judge.id} value={judge.id}>
                  {judge.name}
                  {judge.active ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="manualTeam" className="label">
              Team
            </label>
            <select id="manualTeam" name="teamId" className="input" required>
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="manualRound" className="label">
              Phase
            </label>
            <select id="manualRound" name="round" className="input" defaultValue="screening">
              <option value="screening">Phase 1 · screening</option>
              <option value="final">Phase 2 · finalist</option>
            </select>
          </div>
          <button type="submit" className="btn-primary w-full">
            Assign judge
          </button>
        </form>

        <div className="table-wrap max-h-[26rem] overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Judge</th>
                <th>Phase</th>
                <th className="text-right">Sheet</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="font-medium text-ink-900">{assignment.team_name}</td>
                  <td className="text-ink-600">{assignment.judge_name}</td>
                  <td>
                    <span className={assignment.round === "final" ? "badge-info" : "badge-neutral"}>
                      {assignment.round === "final" ? "Phase 2" : "Phase 1"}
                    </span>
                  </td>
                  <td className="text-right text-xs text-ink-500">
                    {Number(assignment.scores) > 0 ? `${assignment.scores}/4` : "—"}
                  </td>
                  <td className="text-right">
                    <form action={removeAssignment}>
                      <input type="hidden" name="assignmentId" value={assignment.id} />
                      <button type="submit" className="btn-ghost text-xs">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-500">
                    No assignments yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Coverage by team</h2>
        <div className="table-wrap mt-3 max-h-[28rem] overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th className="text-right">Phase 1 sheets</th>
                <th className="text-right">Phase 2 sheets</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((row) => {
                const ok = row.screening.complete >= 2;
                return (
                  <tr key={row.name}>
                    <td className="font-medium text-ink-900">{row.name}</td>
                    <td className="text-right font-mono tabular-nums">
                      {row.screening.complete}/{row.screening.judges}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {row.final.judges > 0 ? `${row.final.complete}/${row.final.judges}` : "—"}
                    </td>
                    <td>
                      {ok ? (
                        <span className="badge-ok">Complete</span>
                      ) : row.screening.judges === 0 ? (
                        <span className="badge-bad">Unassigned</span>
                      ) : (
                        <span className="badge-warn">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          Outlier alert ({outliers.length})
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Advisory only — nothing is dropped automatically. A deviation above 2 points of 100 usually
          means a judge misread the rubric.
        </p>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Judge</th>
                <th>Team</th>
                <th className="text-right">Judge total</th>
                <th className="text-right">Team mean</th>
                <th className="text-right">Deviation</th>
              </tr>
            </thead>
            <tbody>
              {outliers.map((outlier) => (
                <tr key={`${outlier.judgeId}-${outlier.teamId}`}>
                  <td className="font-medium text-ink-900">{outlier.judgeName}</td>
                  <td className="text-ink-600">{outlier.teamName}</td>
                  <td className="text-right font-mono tabular-nums">{outlier.judgeTotal.toFixed(1)}</td>
                  <td className="text-right font-mono tabular-nums">{outlier.teamMean.toFixed(1)}</td>
                  <td className="text-right font-mono tabular-nums">
                    {outlier.deviation > 0 ? "+" : ""}
                    {outlier.deviation.toFixed(1)}
                  </td>
                </tr>
              ))}
              {outliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-500">
                    No outliers.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <form action={saveConflicts} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Declare a conflict</h2>
          <div>
            <label htmlFor="judgeId" className="label">
              Judge
            </label>
            <select id="judgeId" name="judgeId" className="input" required>
              <option value="">Select judge</option>
              {judges.map((judge) => (
                <option key={judge.id} value={judge.id}>
                  {judge.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="teamId" className="label">
              Team
            </label>
            <select id="teamId" name="teamId" className="input" required>
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reason" className="label">
              Reason (optional)
            </label>
            <input id="reason" name="reason" className="input" placeholder="Same college mentor" />
          </div>
          <button type="submit" className="btn-secondary w-full">
            Record conflict
          </button>
        </form>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Judge</th>
                <th>Team</th>
                <th>Reason</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((conflict) => (
                <tr key={`${conflict.judge_id}-${conflict.team_id}`}>
                  <td className="font-medium text-ink-900">{conflict.judge_name}</td>
                  <td className="text-ink-600">{conflict.team_name}</td>
                  <td className="text-ink-500">{conflict.reason ?? "—"}</td>
                  <td className="text-right">
                    <form action={removeConflict}>
                      <input type="hidden" name="judgeId" value={conflict.judge_id} />
                      <input type="hidden" name="teamId" value={conflict.team_id} />
                      <button type="submit" className="btn-ghost text-xs">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {conflicts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-ink-500">
                    No conflicts declared.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
