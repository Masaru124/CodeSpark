import { fail, json, rateLimit, readJson, recordAudit } from "@/lib/api";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { verifyQrToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type Item = { token?: unknown; clientUuid?: unknown };

type ScanResult = {
  token: string;
  clientUuid: string | null;
  status: "ok" | "duplicate" | "invalid" | "error";
  name?: string;
  team?: string;
  at?: string;
  message: string;
};

const MEALS = new Set(["lunch", "snacks", "dinner"]);

export async function POST(request: Request) {
  const session = await apiRole("volunteer", "admin");
  if (!session) return fail("Sign in to scan", 401);

  // Per-staff burst guard. Raise with SCAN_RATE_LIMIT_PER_MIN on event day if
  // one desk legitimately scans faster; the database constraints still own
  // duplicate prevention.
  const limit = await rateLimit(
    `scan:${session.subjectId}`,
    Number(process.env.SCAN_RATE_LIMIT_PER_MIN) || 300,
  );
  if (!limit.ok) return fail("Scanning too fast — slow down for a moment", 429);

  const body = await readJson(request);
  const mode = String(body.mode ?? "checkin");
  if (mode !== "checkin" && !MEALS.has(mode)) return fail("Unknown scan mode");

  const items = Array.isArray(body.items) ? (body.items as Item[]) : [];
  if (items.length === 0) return fail("Nothing to scan");
  if (items.length > 40) return fail("Too many scans in one batch", 413);

  // 1. Verify every signature before touching the database.
  const resolved = await Promise.all(
    items.map(async (item) => {
      const token = String(item.token ?? "").trim();
      const participantId = token ? await verifyQrToken(token) : null;
      return {
        token,
        clientUuid: typeof item.clientUuid === "string" ? item.clientUuid.slice(0, 80) : null,
        participantId,
      };
    }),
  );

  const ids = [...new Set(resolved.map((row) => row.participantId).filter(Boolean))] as string[];
  const people = new Map<
    string,
    { name: string; team: string; team_id: string; verified: boolean; checked_in_at: string | null }
  >();

  if (ids.length > 0) {
    const rows = await q<{
      id: string;
      name: string;
      team: string;
      team_id: string;
      verified: boolean;
      checked_in_at: string | null;
    }>(
      `select p.id, p.name, t.name as team, t.id as team_id, t.payment_verified as verified, p.checked_in_at
         from participants p join teams t on t.id = p.team_id
        where p.id = any($1::uuid[])`,
      [ids],
    );
    for (const row of rows) people.set(row.id, row);
  }

  const results = new Map<string, ScanResult>();

  if (mode === "checkin") {
    const fresh = [...people.entries()]
      .filter(([, person]) => person.checked_in_at === null)
      .map(([id]) => id);

    const updated = new Map<string, string>();
    if (fresh.length > 0) {
      const rows = await q<{ id: string; checked_in_at: string }>(
        `update participants set checked_in_at = now()
          where id = any($1::uuid[]) and checked_in_at is null
          returning id, checked_in_at`,
        [fresh],
      );
      for (const row of rows) updated.set(row.id, row.checked_in_at);
    }

    for (const row of resolved) {
      const person = row.participantId ? people.get(row.participantId) : undefined;
      if (!row.participantId || !person) {
        results.set(row.token + (row.clientUuid ?? ""), {
          token: row.token,
          clientUuid: row.clientUuid,
          status: "invalid",
          message: "Invalid pass — not from this event",
        });
        continue;
      }
      const at = updated.get(row.participantId) ?? person.checked_in_at ?? undefined;
      results.set(row.token + (row.clientUuid ?? ""), {
        token: row.token,
        clientUuid: row.clientUuid,
        status: updated.has(row.participantId) ? "ok" : "duplicate",
        name: person.name,
        team: person.team,
        at: at ?? undefined,
        message: updated.has(row.participantId)
          ? person.verified
            ? "Checked in"
            : "Checked in — payment still unverified"
          : "Already checked in",
      });
    }
  } else {
    const existing = new Map<string, string>();
    if (ids.length > 0) {
      const rows = await q<{ participant_id: string; scanned_at: string }>(
        `select participant_id, scanned_at from meal_scans
          where meal_key = $1 and participant_id = any($2::uuid[])`,
        [mode, ids],
      );
      for (const row of rows) existing.set(row.participant_id, row.scanned_at);
    }

    const toInsert = [...people.entries()].filter(([id]) => !existing.has(id));
    const inserted = new Map<string, string>();

    if (toInsert.length > 0) {
      const values: unknown[] = [];
      const placeholders = toInsert.map(([id, person], index) => {
        const base = index * 5;
        values.push(id, person.team_id, mode, session.label, null);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      const rows = await q<{ participant_id: string; scanned_at: string }>(
        `insert into meal_scans (participant_id, team_id, meal_key, scanned_by, client_uuid)
         values ${placeholders.join(", ")}
         on conflict do nothing
         returning participant_id, scanned_at`,
        values,
      );
      for (const row of rows) inserted.set(row.participant_id, row.scanned_at);
    }

    for (const row of resolved) {
      const person = row.participantId ? people.get(row.participantId) : undefined;
      const key = row.token + (row.clientUuid ?? "");
      if (!row.participantId || !person) {
        results.set(key, {
          token: row.token,
          clientUuid: row.clientUuid,
          status: "invalid",
          message: "Invalid pass — not from this event",
        });
        continue;
      }
      const isNew = inserted.has(row.participantId);
      results.set(key, {
        token: row.token,
        clientUuid: row.clientUuid,
        status: isNew ? "ok" : "duplicate",
        name: person.name,
        team: person.team,
        at: inserted.get(row.participantId) ?? existing.get(row.participantId),
        message: isNew
          ? `${mode} served`
          : `Already served ${mode} at ${new Date(
              existing.get(row.participantId) ?? Date.now(),
            ).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      });
    }
  }

  const payloadItems = resolved.map(
    (row) => results.get(row.token + (row.clientUuid ?? ""))!,
  );
  const okCount = payloadItems.filter((row) => row.status === "ok").length;
  if (payloadItems.length > 1) {
    await recordAudit({
      actor: session.label,
      role: session.role,
      action: `scan.${mode}.batch`,
      entity: "meal_scans",
      payload: { count: payloadItems.length, ok: okCount },
    });
  }

  return json({ ok: true, mode, items: payloadItems });
}
