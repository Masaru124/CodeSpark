import Link from "next/link";
import { q } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getConfig } from "@/lib/config";
import { getRubric } from "@/lib/judging";

export const dynamic = "force-dynamic";
export const metadata = { title: "My teams" };

type Assignment = {
  id: string;
  round: string;
  team_id: string;
  name: string;
  college: string | null;
  track: string | null;
  criteria: number;
  updated_at: string | null;
};

export default async function JudgeHome() {
  const session = await getSession();
  if (!session?.subjectId) return null;

  const [assignments, rubric, config] = await Promise.all([
    q<Assignment>(
      `select a.id, a.round, t.id as team_id, t.name, t.college, t.track,
              (select count(distinct s.rubric_key) from scores s where s.assignment_id = a.id)::int as criteria,
              (select max(s.updated_at) from scores s where s.assignment_id = a.id) as updated_at
         from assignments a join teams t on t.id = a.team_id
        where a.judge_id = $1
        order by a.round, t.name`,
      [session.subjectId],
    ),
    getRubric(),
    getConfig(),
  ]);

  const screening = assignments.filter((row) => row.round === "screening");
  const final = assignments.filter((row) => row.round === "final");
  const done = assignments.filter((row) => row.criteria >= rubric.length).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">My teams</h1>
        <p className="mt-1 text-sm text-ink-600">
          {done}/{assignments.length} score sheets complete · {rubric.length} criteria, 10 points each.
          Scores are saved on this device first, so a Wi-Fi drop never loses work.
        </p>
      </div>

      {[
        { label: "Screening round", list: screening },
        { label: "Finalist round", list: final },
      ].map(({ label, list }) => {
        if (list.length === 0) return null;
        return (
          <section key={label}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">{label}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((assignment) => {
                const complete = assignment.criteria >= rubric.length;
                return (
                  <Link
                    key={assignment.id}
                    href={`/judge/${assignment.id}`}
                    className="card-pad transition hover:border-spark-300 hover:shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink-900">{assignment.name}</p>
                        <p className="text-xs text-ink-500">{assignment.college ?? "—"}</p>
                        {assignment.track ? (
                          <p className="mt-1 text-xs text-ink-400">{assignment.track}</p>
                        ) : null}
                      </div>
                      {complete ? (
                        <span className="badge-ok">Scored</span>
                      ) : assignment.criteria > 0 ? (
                        <span className="badge-warn">
                          {assignment.criteria}/{rubric.length}
                        </span>
                      ) : (
                        <span className="badge-neutral">New</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {assignments.length === 0 ? (
        <div className="card-pad text-sm text-ink-600">
          No teams assigned yet. The tech desk assigns judges before the screening round — check{" "}
          {config.event.hack_start ? "back after 17:30" : "with the organisers"}.
        </div>
      ) : null}
    </div>
  );
}
