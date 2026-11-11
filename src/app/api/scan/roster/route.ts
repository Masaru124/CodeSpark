import { fail, json } from "@/lib/api";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { signTeamToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type RosterEntry = {
  token: string;
  team: string;
  college: string | null;
  total: number;
  checkedIn: number;
  lead: string | null;
  leadCheckedIn: boolean;
};

// The roster changes only when a team is imported, so a short per-isolate cache
// keeps 500 concurrent scanners off the database.
const TTL_MS = 30_000;
let cache: { at: number; payload: { generatedAt: string; teams: RosterEntry[] } } | null = null;

export async function GET() {
  const session = await apiRole("volunteer", "admin");
  if (!session) return fail("Sign in to load the roster", 401);

  if (cache && Date.now() - cache.at < TTL_MS) {
    return json({ ok: true, cached: true, ...cache.payload });
  }

  const rows = await q<{
    id: string;
    name: string;
    college: string | null;
    total: number;
    checked_in: number;
    lead: string | null;
    lead_checked_in: boolean;
  }>(
    `select t.id, t.name, t.college,
            count(p.id)::int as total,
            count(p.checked_in_at)::int as checked_in,
            (array_agg(p.name order by p.is_leader desc, p.created_at, p.name))[1] as lead,
            coalesce((array_agg(p.checked_in_at is not null
               order by p.is_leader desc, p.created_at, p.name))[1], false) as lead_checked_in
       from teams t left join participants p on p.team_id = t.id
      group by t.id
      order by t.name`,
  );

  const teams: RosterEntry[] = await Promise.all(
    rows.map(async (row) => ({
      token: await signTeamToken(row.id),
      team: row.name,
      college: row.college,
      total: Number(row.total),
      checkedIn: Number(row.checked_in),
      lead: row.lead,
      leadCheckedIn: Boolean(row.lead_checked_in),
    })),
  );

  const payload = { generatedAt: new Date().toISOString(), teams };
  cache = { at: Date.now(), payload };
  return json({ ok: true, cached: false, ...payload });
}
