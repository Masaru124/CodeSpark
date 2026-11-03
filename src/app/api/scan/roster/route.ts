import { fail, json } from "@/lib/api";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { signQrToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type RosterEntry = {
  token: string;
  name: string;
  team: string;
  checkedInAt: string | null;
  meals: string[];
};

// The roster changes only when a team is imported, so a short per-isolate cache
// keeps 500 concurrent scanners off the database.
const TTL_MS = 30_000;
let cache: { at: number; payload: { generatedAt: string; participants: RosterEntry[] } } | null = null;

export async function GET() {
  const session = await apiRole("volunteer", "admin");
  if (!session) return fail("Sign in to load the roster", 401);

  if (cache && Date.now() - cache.at < TTL_MS) {
    return json({ ok: true, cached: true, ...cache.payload });
  }

  const rows = await q<{
    id: string;
    name: string;
    team: string;
    checked_in_at: string | null;
    meals: string[] | null;
  }>(
    `select p.id, p.name, t.name as team, p.checked_in_at,
            array_remove(array_agg(ms.meal_key), null) as meals
       from participants p
       join teams t on t.id = p.team_id
       left join meal_scans ms on ms.participant_id = p.id
      group by p.id, p.name, t.name, p.checked_in_at
      order by t.name, p.name`,
  );

  const participants: RosterEntry[] = await Promise.all(
    rows.map(async (row) => ({
      token: await signQrToken(row.id),
      name: row.name,
      team: row.team,
      checkedInAt: row.checked_in_at,
      meals: row.meals ?? [],
    })),
  );

  const payload = { generatedAt: new Date().toISOString(), participants };
  cache = { at: Date.now(), payload };
  return json({ ok: true, cached: false, ...payload });
}
