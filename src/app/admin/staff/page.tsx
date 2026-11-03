import Flash from "@/components/Flash";
import { q } from "@/lib/db";
import { addJudge, addVolunteer, setStaffActive } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judges & volunteers" };

type Judge = { id: string; name: string; email: string | null; invite_code: string; active: boolean };
type Volunteer = { id: string; name: string; code: string; active: boolean };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  const [judges, volunteers] = await Promise.all([
    q<Judge>(`select id, name, email, invite_code, active from judges order by active desc, name`),
    q<Volunteer>(`select id, name, code, active from volunteers order by active desc, name`),
  ]);

  return (
    <div className="max-w-5xl">
      <Flash ok={ok} error={error} />

      <h1 className="text-2xl font-bold tracking-tight text-ink-900">Judges &amp; volunteers</h1>
      <p className="mt-1 text-sm text-ink-600">
        Codes are the whole login for staff phones — no email round trip on event day. Deactivate a
        code the moment a device goes missing.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <form action={addJudge} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Add judge</h2>
          <div>
            <label htmlFor="judge-name" className="label">
              Name
            </label>
            <input id="judge-name" name="name" required className="input" placeholder="Dr. Anil Kumar" />
          </div>
          <div>
            <label htmlFor="judge-email" className="label">
              Email (optional)
            </label>
            <input id="judge-email" name="email" type="email" className="input" placeholder="anil@college.edu" />
          </div>
          <button type="submit" className="btn-primary">
            Add judge
          </button>
        </form>

        <form action={addVolunteer} className="card-pad space-y-3">
          <h2 className="text-sm font-bold text-ink-900">Add volunteer</h2>
          <div>
            <label htmlFor="volunteer-name" className="label">
              Name
            </label>
            <input id="volunteer-name" name="name" required className="input" placeholder="Desk 1 — Priya" />
          </div>
          <button type="submit" className="btn-primary">
            Add volunteer
          </button>
        </form>
      </div>

      <section className="mt-7">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Judges ({judges.length})</h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Login code</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {judges.map((judge) => (
                <tr key={judge.id}>
                  <td className="font-semibold text-ink-900">{judge.name}</td>
                  <td className="text-ink-600">{judge.email ?? "—"}</td>
                  <td>
                    <code className="rounded bg-ink-100 px-2 py-1 font-mono text-sm tracking-[0.2em]">
                      {judge.invite_code}
                    </code>
                  </td>
                  <td>{judge.active ? <span className="badge-ok">Active</span> : <span className="badge-neutral">Disabled</span>}</td>
                  <td className="text-right">
                    <form action={setStaffActive}>
                      <input type="hidden" name="kind" value="judge" />
                      <input type="hidden" name="id" value={judge.id} />
                      <input type="hidden" name="active" value={judge.active ? "false" : "true"} />
                      <button type="submit" className="btn-ghost text-xs">
                        {judge.active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {judges.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-ink-500">
                    No judges yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
          Volunteers ({volunteers.length})
        </h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Login code</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.map((volunteer) => (
                <tr key={volunteer.id}>
                  <td className="font-semibold text-ink-900">{volunteer.name}</td>
                  <td>
                    <code className="rounded bg-ink-100 px-2 py-1 font-mono text-sm tracking-[0.2em]">
                      {volunteer.code}
                    </code>
                  </td>
                  <td>{volunteer.active ? <span className="badge-ok">Active</span> : <span className="badge-neutral">Disabled</span>}</td>
                  <td className="text-right">
                    <form action={setStaffActive}>
                      <input type="hidden" name="kind" value="volunteer" />
                      <input type="hidden" name="id" value={volunteer.id} />
                      <input type="hidden" name="active" value={volunteer.active ? "false" : "true"} />
                      <button type="submit" className="btn-ghost text-xs">
                        {volunteer.active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {volunteers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-ink-500">
                    No volunteers yet.
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
