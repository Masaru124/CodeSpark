import { q } from "@/lib/db";
import { getConfig } from "@/lib/config";

export type Rubric = { key: string; label: string; weight: number; max_score: number; sort: number };

export type RankedTeam = {
  teamId: string;
  name: string;
  college: string | null;
  track: string | null;
  screening: number | null;
  final: number | null;
  total: number;
  depth: number;
  demo: number;
  judgesScreening: number;
  judgesFinal: number;
  rank: number;
};

type Row = {
  team_id: string;
  name: string;
  college: string | null;
  track: string | null;
  round: string | null;
  judge_id: string | null;
  rubric_key: string | null;
  score: string | number | null;
};

export async function getRubric(): Promise<Rubric[]> {
  const rows = await q<{ key: string; label: string; weight: number; max_score: string; sort: number }>(
    `select key, label, weight, max_score, sort from rubric order by sort`,
  );
  return rows.map((row) => ({ ...row, max_score: Number(row.max_score) }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Weighted total per judge = Σ (score / max_score × weight), then the team score
 * is the mean across judges. Finalists blend screening and finalist rounds
 * using the configured weights. Ties: depth → demo → finalist round.
 */
export async function computeRankings(): Promise<RankedTeam[]> {
  const [{ judging }, rubric, rows] = await Promise.all([
    getConfig(true),
    getRubric(),
    q<Row>(
      `select t.id as team_id, t.name, t.college, t.track,
              a.round, a.judge_id, s.rubric_key, s.score
         from teams t
         left join assignments a on a.team_id = t.id
         left join scores s on s.assignment_id = a.id`,
    ),
  ]);

  const weights = new Map(rubric.map((r) => [r.key, r]));
  type Bucket = { round: string; judgeId: string; sum: number; depth: number; demo: number; criteria: Set<string> };
  const perTeam = new Map<string, { meta: Omit<Row, "round" | "judge_id" | "rubric_key" | "score">; buckets: Map<string, Bucket> }>();

  for (const row of rows) {
    let team = perTeam.get(row.team_id);
    if (!team) {
      team = {
        meta: { team_id: row.team_id, name: row.name, college: row.college, track: row.track },
        buckets: new Map(),
      };
      perTeam.set(row.team_id, team);
    }
    if (!row.judge_id || !row.round || row.rubric_key === null || row.score === null) continue;

    const key = `${row.round}:${row.judge_id}`;
    let bucket = team.buckets.get(key);
    if (!bucket) {
      bucket = { round: row.round, judgeId: row.judge_id, sum: 0, depth: 0, demo: 0, criteria: new Set() };
      team.buckets.set(key, bucket);
    }
    const criterion = weights.get(row.rubric_key);
    const score = Number(row.score);
    if (criterion && !bucket.criteria.has(row.rubric_key)) {
      bucket.sum += (score / criterion.max_score) * criterion.weight;
      bucket.criteria.add(row.rubric_key);
      if (row.rubric_key === "depth") bucket.depth = score;
      if (row.rubric_key === "demo") bucket.demo = score;
    }
  }

  const ranked: RankedTeam[] = [];
  for (const [teamId, team] of perTeam) {
    const screening: number[] = [];
    const final: number[] = [];
    const depth: number[] = [];
    const demo: number[] = [];

    for (const bucket of team.buckets.values()) {
      // A judge total only counts once every rubric criterion is present.
      if (bucket.criteria.size < rubric.length) continue;
      (bucket.round === "final" ? final : screening).push(bucket.sum);
      depth.push(bucket.depth);
      demo.push(bucket.demo);
    }

    const mean = (values: number[]) =>
      values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length);

    const screeningAvg = mean(screening);
    const finalAvg = mean(final);

    let total = 0;
    if (finalAvg !== null && screeningAvg !== null) {
      total = judging.final_weight * finalAvg + judging.screening_weight * screeningAvg;
    } else if (finalAvg !== null) {
      total = finalAvg;
    } else if (screeningAvg !== null) {
      total = screeningAvg;
    }

    ranked.push({
      teamId,
      name: team.meta.name,
      college: team.meta.college,
      track: team.meta.track,
      screening: screeningAvg,
      final: finalAvg,
      total: round2(total),
      depth: mean(depth) ?? 0,
      demo: mean(demo) ?? 0,
      judgesScreening: screening.length,
      judgesFinal: final.length,
      rank: 0,
    });
  }

  ranked.sort(
    (a, b) =>
      b.total - a.total ||
      b.depth - a.depth ||
      b.demo - a.demo ||
      (b.final ?? 0) - (a.final ?? 0) ||
      a.name.localeCompare(b.name),
  );
  ranked.forEach((team, index) => {
    team.rank = index + 1;
  });
  return ranked;
}

export type CompletionRow = {
  teamId: string;
  name: string;
  round: string;
  judges: number;
  complete: number;
};

/** How many assigned judges have submitted a full score sheet per team. */
export async function judgingProgress(): Promise<CompletionRow[]> {
  const rows = await q<{ team_id: string; name: string; round: string; judges: string; complete: string }>(
    `select a.team_id, t.name, a.round,
            count(*)::text as judges,
            count(*) filter (where sub.criteria >= $1)::text as complete
       from assignments a
       join teams t on t.id = a.team_id
       left join lateral (
         select count(distinct s.rubric_key) as criteria
           from scores s where s.assignment_id = a.id
       ) sub on true
      group by a.team_id, t.name, a.round
      order by t.name, a.round`,
    [4],
  );
  return rows.map((row) => ({
    teamId: row.team_id,
    name: row.name,
    round: row.round,
    judges: Number(row.judges),
    complete: Number(row.complete),
  }));
}

export type Outlier = {
  judgeId: string;
  judgeName: string;
  teamId: string;
  teamName: string;
  judgeTotal: number;
  teamMean: number;
  deviation: number;
};

/** Judge totals that sit further than `threshold` from the team mean. */
export async function findOutliers(threshold: number): Promise<Outlier[]> {
  const rows = await q<{
    judge_id: string;
    judge_name: string;
    team_id: string;
    team_name: string;
    judge_total: string;
    team_mean: string;
    judges: string;
  }>(
    `with totals as (
       select a.id as assignment_id, a.judge_id, a.team_id, a.round,
              sum((s.score / r.max_score) * r.weight) as total
         from assignments a
         join scores s on s.assignment_id = a.id
         join rubric r on r.key = s.rubric_key
        where a.round = 'screening'
        group by a.id, a.judge_id, a.team_id, a.round
       having count(distinct s.rubric_key) = (select count(*) from rubric)
     ),
     means as (
       select team_id, avg(total) as mean, count(*) as judges
         from totals group by team_id
     )
     select jt.judge_id, ju.name as judge_name, jt.team_id, t.name as team_name,
            jt.total::text as judge_total, m.mean::text as team_mean, m.judges::text
       from totals jt
       join means m on m.team_id = jt.team_id
       join judges ju on ju.id = jt.judge_id
       join teams t on t.id = jt.team_id
      where m.judges >= 2 and abs(jt.total - m.mean) > $1
      order by abs(jt.total - m.mean) desc
      limit 100`,
    [threshold],
  );
  return rows.map((row) => ({
    judgeId: row.judge_id,
    judgeName: row.judge_name,
    teamId: row.team_id,
    teamName: row.team_name,
    judgeTotal: Number(row.judge_total),
    teamMean: Number(row.team_mean),
    deviation: Number(row.judge_total) - Number(row.team_mean),
  }));
}
