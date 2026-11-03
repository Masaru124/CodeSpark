import Link from "next/link";
import Flash from "@/components/Flash";
import { q } from "@/lib/db";
import { togglePayment } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams & passes" };

type TeamRow = {
  id: string;
  name: string;
  college: string | null;
  track: string | null;
  payment_verified: boolean;
  payment_ref: string | null;
  participants: number;
  checked_in: number;
};

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; q?: string }>;
}) {
  const { ok, error, q: search } = await searchParams;
  const term = (search ?? "").trim();

  const teams = await q<TeamRow>(
    `select t.id, t.name, t.college, t.track, t.payment_verified, t.payment_ref,
            count(p.id)::int as participants,
            count(p.checked_in_at)::int as checked_in
       from teams t
       left join participants p on p.team_id = t.id
      where ($1 = '' or t.name ilike '%' || $1 || '%' or t.college ilike '%' || $1 || '%')
      group by t.id
      order by t.payment_verified asc, t.name
      limit 500`,
    [term],
  );

  const verified = teams.filter((team) => team.payment_verified).length;

  return (
    <div>
      <Flash ok={ok} error={error} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Teams &amp; passes</h1>
          <p className="mt-1 text-sm text-ink-600">
            {teams.length} teams in view · {verified} payment verified. Passes are emailed only to
            verified teams.
          </p>
        </div>
        <form className="flex gap-2" action="/admin/teams">
          <input
            name="q"
            defaultValue={term}
            className="input w-56"
            placeholder="Search team or college"
            aria-label="Search teams"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      </div>

      {teams.length === 0 ? (
        <div className="card-pad text-sm text-ink-600">
          No teams yet.{" "}
          <Link href="/admin/import" className="link">
            Import the registration CSV
          </Link>
          .
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>College / track</th>
                <th className="text-right">People</th>
                <th className="text-right">Checked in</th>
                <th>Payment</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <Link href={`/admin/teams/${team.id}`} className="font-semibold text-ink-900 hover:text-spark-700">
                      {team.name}
                    </Link>
                    {team.payment_ref ? (
                      <span className="block font-mono text-xs text-ink-400">{team.payment_ref}</span>
                    ) : null}
                  </td>
                  <td className="text-ink-600">
                    {team.college ?? "—"}
                    {team.track ? <span className="block text-xs text-ink-400">{team.track}</span> : null}
                  </td>
                  <td className="text-right font-mono tabular-nums">{team.participants}</td>
                  <td className="text-right font-mono tabular-nums">{team.checked_in}</td>
                  <td>
                    {team.payment_verified ? (
                      <span className="badge-ok">Verified</span>
                    ) : (
                      <span className="badge-warn">Pending</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <form action={togglePayment}>
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="verified" value={team.payment_verified ? "false" : "true"} />
                        <button type="submit" className={team.payment_verified ? "btn-ghost text-xs" : "btn-primary text-xs"}>
                          {team.payment_verified ? "Unverify" : "Verify"}
                        </button>
                      </form>
                      <Link href={`/admin/teams/${team.id}`} className="btn-secondary text-xs">
                        Passes
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
