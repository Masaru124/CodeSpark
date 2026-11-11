import { fail, json, rateLimit, readJson, recordAudit } from "@/lib/api";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { verifyTeamToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type Item = { token?: unknown; clientUuid?: unknown };

type ScanResult = {
  token: string;
  clientUuid: string | null;
  status: "ok" | "duplicate" | "invalid";
  name?: string;
  team?: string;
  message: string;
};

type TeamScanRow = {
  id: string;
  name: string;
  college: string | null;
  total: number;
  lead_name: string | null;
  changed: number;
};

// One QR per team, and only the team lead is checked in. Meals are not scanned
// at this event, so the endpoint accepts check-in batches only. The whole batch
// is one SQL statement: no per-team round trips.
export async function POST(request: Request) {
  const session = await apiRole("volunteer", "admin");
  if (!session) return fail("Sign in to scan", 401);

  const limit = await rateLimit(
    `scan:${session.subjectId}`,
    Number(process.env.SCAN_RATE_LIMIT_PER_MIN) || 300,
  );
  if (!limit.ok) return fail("Scanning too fast — slow down for a moment", 429);

  const body = await readJson(request);
  const mode = String(body.mode ?? "checkin");
  if (mode !== "checkin") return fail("Only check-in scans are used at this event");

  const items = Array.isArray(body.items) ? (body.items as Item[]) : [];
  if (items.length === 0) return fail("Nothing to scan");
  if (items.length > 40) return fail("Too many scans in one batch", 413);

  // Verify every team signature before touching the database.
  const resolved = await Promise.all(
    items.map(async (item) => {
      const token = String(item.token ?? "").trim();
      const teamId = token ? await verifyTeamToken(token) : null;
      return {
        token,
        clientUuid: typeof item.clientUuid === "string" ? item.clientUuid.slice(0, 80) : null,
        teamId,
      };
    }),
  );

  const ids = [...new Set(resolved.map((row) => row.teamId).filter(Boolean))] as string[];
  const teams = new Map<string, TeamScanRow>();

  if (ids.length > 0) {
    const rows = await q<TeamScanRow>(
      `with target as (
         select t.id, t.name, t.college,
                (select count(*) from participants p where p.team_id = t.id)::int as total,
                (select p.name from participants p
                  where p.team_id = t.id
                  order by p.is_leader desc, p.created_at, p.name limit 1) as lead_name,
                (select p.id from participants p
                  where p.team_id = t.id
                  order by p.is_leader desc, p.created_at, p.name limit 1) as lead_id
           from teams t
          where t.id = any($1::uuid[])
       ),
       changed as (
         update participants p set checked_in_at = now()
           from target
          where p.id = target.lead_id and p.checked_in_at is null
          returning p.team_id
       )
       select target.id, target.name, target.college, target.total, target.lead_name,
              (select count(*) from changed c where c.team_id = target.id)::int as changed
         from target`,
      [ids],
    );
    for (const row of rows) {
      teams.set(row.id, {
        ...row,
        total: Number(row.total),
        changed: Number(row.changed),
      });
    }
  }

  const results = new Map<string, ScanResult>();

  for (const row of resolved) {
    const key = row.token + (row.clientUuid ?? "");
    const team = row.teamId ? teams.get(row.teamId) : undefined;

    if (!row.teamId || !team) {
      results.set(key, {
        token: row.token,
        clientUuid: row.clientUuid,
        status: "invalid",
        message: "Invalid team pass — not from this event",
      });
      continue;
    }

    if (team.total === 0) {
      results.set(key, {
        token: row.token,
        clientUuid: row.clientUuid,
        status: "invalid",
        name: team.name,
        team: team.college ?? undefined,
        message: "This team has no registered members yet",
      });
      continue;
    }

    if (team.changed > 0) {
      results.set(key, {
        token: row.token,
        clientUuid: row.clientUuid,
        status: "ok",
        name: team.name,
        team: team.college ?? undefined,
        message: team.lead_name
          ? `Team lead ${team.lead_name} checked in`
          : "Team lead checked in",
      });
    } else {
      results.set(key, {
        token: row.token,
        clientUuid: row.clientUuid,
        status: "duplicate",
        name: team.name,
        team: team.college ?? undefined,
        message: team.lead_name
          ? `${team.lead_name} (team lead) already checked in`
          : "Team lead already checked in",
      });
    }
  }

  const payloadItems = resolved.map((row) => results.get(row.token + (row.clientUuid ?? ""))!);
  const okCount = payloadItems.filter((row) => row.status === "ok").length;
  if (payloadItems.length > 1) {
    await recordAudit({
      actor: session.label,
      role: session.role,
      action: "scan.checkin.batch",
      entity: "participants",
      payload: { count: payloadItems.length, ok: okCount },
    });
  }

  return json({ ok: true, mode: "checkin", items: payloadItems });
}
