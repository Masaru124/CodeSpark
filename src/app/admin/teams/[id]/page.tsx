import Link from "next/link";
import { notFound } from "next/navigation";
import Flash from "@/components/Flash";
import PrintButton from "@/components/PrintButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import QrPass from "@/components/QrPass";
import { one, q } from "@/lib/db";
import { signTeamToken } from "@/lib/crypto";
import { baseUrl } from "@/lib/site";
import { fmtDateTime } from "@/lib/format";
import {
  addParticipant,
  deleteParticipant,
  deleteTeam,
  togglePayment,
  updateParticipant,
  updateTeam,
} from "../../actions";

export const dynamic = "force-dynamic";

type Participant = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_leader: boolean;
  checked_in_at: string | null;
};

export default async function TeamPassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;

  const team = await one<{
    id: string;
    name: string;
    college: string | null;
    track: string | null;
    payment_verified: boolean;
    payment_ref: string | null;
    size: number;
    notes: string | null;
  }>(
    `select id, name, college, track, payment_verified, payment_ref, size, notes
       from teams where id = $1`,
    [id],
  );

  if (!team) notFound();

  const participants = await q<Participant>(
    `select id, name, email, phone, is_leader, checked_in_at from participants
      where team_id = $1 order by is_leader desc, name`,
    [team.id],
  );

  const origin = await baseUrl();
  const token = await signTeamToken(team.id);
  const passUrl = `${origin}/pass/${token}`;
  const lead = participants.find((participant) => participant.is_leader) ?? participants[0] ?? null;
  const leadCheckedIn = lead?.checked_in_at ?? null;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Flash ok={ok} error={error} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin/teams" className="text-xs font-semibold text-spark-700">
              ← All teams
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{team.name}</h1>
            <p className="mt-1 text-sm text-ink-600">
              {team.college ?? "—"}
              {team.track ? ` · ${team.track}` : ""} · {participants.length} participants ·{" "}
              {leadCheckedIn ? "team lead checked in" : "team lead not checked in"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {team.payment_verified ? (
              <span className="badge-ok">Payment verified</span>
            ) : (
              <span className="badge-warn">Payment pending</span>
            )}
            <form action={togglePayment}>
              <input type="hidden" name="teamId" value={team.id} />
              <input type="hidden" name="verified" value={team.payment_verified ? "false" : "true"} />
              <button type="submit" className="btn-secondary">
                {team.payment_verified ? "Mark unverified" : "Mark payment verified"}
              </button>
            </form>
            <PrintButton />
            <form action={deleteTeam}>
              <input type="hidden" name="teamId" value={team.id} />
              <ConfirmSubmitButton
                label="Delete team"
                message={`Delete ${team.name}? This also removes its ${participants.length} participant(s), check-ins, meal scans, scores and submission. This cannot be undone.`}
                className="btn-ghost text-xs text-red-600 hover:text-red-700"
              />
            </form>
          </div>
        </div>
      </div>

      <details className="card-pad no-print">
        <summary className="cursor-pointer text-sm font-bold text-ink-900">
          Edit team details
        </summary>
        <form action={updateTeam} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="teamId" value={team.id} />
          <div>
            <label htmlFor="team-name" className="label">
              Team / project name *
            </label>
            <input
              id="team-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={team.name}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="team-college" className="label">
              College
            </label>
            <input
              id="team-college"
              name="college"
              maxLength={120}
              defaultValue={team.college ?? ""}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="team-track" className="label">
              Track
            </label>
            <input
              id="team-track"
              name="track"
              maxLength={80}
              defaultValue={team.track ?? ""}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="team-size" className="label">
              Declared team size
            </label>
            <input
              id="team-size"
              name="size"
              type="number"
              min={1}
              max={10}
              defaultValue={team.size}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="team-ref" className="label">
              Payment reference
            </label>
            <input
              id="team-ref"
              name="payment_ref"
              maxLength={120}
              defaultValue={team.payment_ref ?? ""}
              className="input"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="team-notes" className="label">
              Internal notes
            </label>
            <textarea
              id="team-notes"
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={team.notes ?? ""}
              className="input"
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">
              Save team details
            </button>
          </div>
        </form>
      </details>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <article className="card-pad print-item break-inside-avoid">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-spark-700">
                CODE SPARK 2026 · TEAM PASS
              </p>
              <h2 className="mt-1 truncate text-2xl font-bold text-ink-900">{team.name}</h2>
              <p className="truncate text-sm text-ink-600">{team.college ?? ""}</p>
              <p className="mt-3 text-xs text-ink-500">
                One QR for the whole team. Scanning it checks in the team lead only. Meals are not
                scanned at this event.
              </p>
              <dl className="mt-3 space-y-1 text-xs text-ink-600">
                <div>
                  <dt className="inline font-semibold">Members: </dt>
                  <dd className="inline">{participants.length}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Team lead: </dt>
                  <dd className="inline">
                    {lead ? lead.name : "not set"} · {leadCheckedIn ? "checked in" : "not checked in"}
                  </dd>
                </div>
              </dl>
            </div>
            <QrPass value={passUrl} size={190} className="shrink-0 rounded-lg ring-1 ring-ink-200" />
          </div>
          <input
            readOnly
            value={passUrl}
            className="input mt-4 select-all font-mono text-[11px] text-ink-600 no-print"
            aria-label={`Team pass link for ${team.name}`}
          />
          <p className="mt-1 hidden font-mono text-[10px] text-ink-500 print:block">{passUrl}</p>
        </article>

        <section className="card-pad">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            Members ({participants.length})
          </h2>
          <ul className="mt-3 divide-y divide-ink-100 text-sm">
            {participants.map((participant) => (
              <li key={participant.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">
                    {participant.name}
                    {participant.is_leader ? <span className="ml-2 badge-info">Lead</span> : null}
                  </span>
                  <span
                    className={
                      participant.checked_in_at
                        ? "text-xs font-medium text-emerald-700"
                        : "text-xs text-ink-400"
                    }
                  >
                    {participant.checked_in_at ? "checked in" : "not in"}
                  </span>
                </div>
                {participant.email || participant.phone ? (
                  <p className="text-xs text-ink-500">
                    {participant.email ?? ""}
                    {participant.email && participant.phone ? " · " : ""}
                    {participant.phone ?? ""}
                  </p>
                ) : null}
                <details className="mt-2 no-print">
                  <summary className="cursor-pointer text-xs font-semibold text-spark-700">
                    Edit member
                  </summary>
                  <form action={updateParticipant} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="teamId" value={team.id} />
                    <input type="hidden" name="participantId" value={participant.id} />
                    <div>
                      <label htmlFor={`name-${participant.id}`} className="label">
                        Name *
                      </label>
                      <input
                        id={`name-${participant.id}`}
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={participant.name}
                        className="input"
                      />
                    </div>
                    <div>
                      <label htmlFor={`email-${participant.id}`} className="label">
                        Email
                      </label>
                      <input
                        id={`email-${participant.id}`}
                        name="email"
                        type="email"
                        maxLength={160}
                        defaultValue={participant.email ?? ""}
                        className="input"
                      />
                    </div>
                    <div>
                      <label htmlFor={`phone-${participant.id}`} className="label">
                        Phone
                      </label>
                      <input
                        id={`phone-${participant.id}`}
                        name="phone"
                        maxLength={30}
                        defaultValue={participant.phone ?? ""}
                        className="input"
                      />
                    </div>
                    <label className="flex items-center gap-2 self-end text-xs text-ink-600">
                      <input
                        type="checkbox"
                        name="is_leader"
                        value="true"
                        defaultChecked={participant.is_leader}
                        className="h-4 w-4"
                      />
                      Team lead
                    </label>
                    <div className="sm:col-span-2">
                      <button type="submit" className="btn-primary text-xs">
                        Save member
                      </button>
                    </div>
                  </form>
                  <form action={deleteParticipant} className="mt-2">
                    <input type="hidden" name="teamId" value={team.id} />
                    <input type="hidden" name="participantId" value={participant.id} />
                    <ConfirmSubmitButton
                      label="Remove member"
                      message={`Remove ${participant.name} from ${team.name}?${
                        participant.is_leader ? " Another member will be promoted to team lead." : ""
                      }`}
                      className="btn-ghost text-xs text-red-600 hover:text-red-700"
                    />
                  </form>
                </details>
              </li>
            ))}
            {participants.length === 0 ? (
              <li className="py-2 text-sm text-ink-500">
                No members yet. Import the registration sheet to add them.
              </li>
            ) : null}
          </ul>
          <details className="mt-4 no-print">
            <summary className="cursor-pointer text-xs font-semibold text-spark-700">
              Add a member
            </summary>
            <form action={addParticipant} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="teamId" value={team.id} />
              <div>
                <label htmlFor="new-member-name" className="label">
                  Name *
                </label>
                <input
                  id="new-member-name"
                  name="name"
                  required
                  maxLength={120}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="new-member-email" className="label">
                  Email
                </label>
                <input
                  id="new-member-email"
                  name="email"
                  type="email"
                  maxLength={160}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="new-member-phone" className="label">
                  Phone
                </label>
                <input
                  id="new-member-phone"
                  name="phone"
                  maxLength={30}
                  className="input"
                />
              </div>
              <label className="flex items-center gap-2 self-end text-xs text-ink-600">
                <input type="checkbox" name="is_leader" value="true" className="h-4 w-4" />
                Make team lead
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className="btn-primary text-xs">
                  Add member
                </button>
              </div>
            </form>
          </details>

          <p className="mt-3 text-xs text-ink-500">
            Check-in times:{" "}
            {participants.some((participant) => participant.checked_in_at)
              ? participants
                  .filter((participant) => participant.checked_in_at)
                  .map((participant) => `${participant.name} ${fmtDateTime(participant.checked_in_at)}`)
                  .join(" · ")
              : "none yet"}
          </p>
        </section>
      </div>

      <p className="text-xs text-ink-500 no-print">
        This pass is an HMAC-signed token for one team. Send the link in your team group or print it
        as a paper backup for the check-in desk. Deleting and re-importing a team keeps the same
        token only while the team row survives.
      </p>
    </div>
  );
}
