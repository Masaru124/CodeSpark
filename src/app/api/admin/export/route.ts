import Papa from "papaparse";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await apiRole("admin");
  if (!session) return new Response("Unauthorized", { status: 401 });

  const type = new URL(request.url).searchParams.get("type") ?? "rankings";

  let rows: Record<string, unknown>[] = [];
  let filename = "export.csv";

  if (type === "rankings") {
    filename = "code-spark-rankings.csv";
    rows = await q(
      `select r.rank, t.name as team, t.college, t.track,
              r.screening_total::float as screening_total,
              r.final_total::float as final_total,
              r.published, r.computed_at
         from results r join teams t on t.id = r.team_id
        order by r.rank nulls last, t.name`,
    );
  } else if (type === "scores") {
    filename = "code-spark-scores.csv";
    rows = await q(
      `select t.name as team, a.round, j.name as judge, rb.label as criterion,
              s.score, s.comment, s.updated_at
         from scores s
         join assignments a on a.id = s.assignment_id
         join teams t on t.id = a.team_id
         join judges j on j.id = a.judge_id
         join rubric rb on rb.key = s.rubric_key
        order by t.name, a.round, j.name, rb.sort`,
    );
  } else if (type === "scans") {
    filename = "code-spark-meal-scans.csv";
    rows = await q(
      `select t.name as team, p.name as participant, p.email, p.phone,
              ms.meal_key, ms.scanned_at, ms.scanned_by
         from meal_scans ms
         join participants p on p.id = ms.participant_id
         join teams t on t.id = ms.team_id
        order by ms.scanned_at`,
    );
  } else if (type === "teams") {
    filename = "code-spark-teams.csv";
    rows = await q(
      `select t.name as team, t.college, t.track, t.size, t.payment_verified, t.payment_ref,
              p.name as participant, p.email, p.phone, p.checked_in_at,
              (select count(*) from meal_scans ms where ms.participant_id = p.id)::int as meals_served
         from teams t join participants p on p.team_id = t.id
        order by t.name, p.name`,
    );
  } else if (type === "checkins") {
    filename = "code-spark-checkins.csv";
    rows = await q(
      `select t.name as team, p.name as participant, p.email, p.phone, p.checked_in_at
         from participants p join teams t on t.id = p.team_id
        order by t.name, p.name`,
    );
  } else {
    return new Response("Unknown export type", { status: 400 });
  }

  const csv = Papa.unparse(rows as never[], { quotes: true });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
