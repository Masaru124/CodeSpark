import Link from "next/link";
import { notFound } from "next/navigation";
import Flash from "@/components/Flash";
import PrintButton from "@/components/PrintButton";
import QrPass from "@/components/QrPass";
import { one, q } from "@/lib/db";
import { signQrToken } from "@/lib/crypto";
import { baseUrl } from "@/lib/site";
import { fmtDateTime } from "@/lib/format";
import { togglePayment } from "../../actions";

export const dynamic = "force-dynamic";

type Participant = {
  id: string;
  name: string;
  email: string;
  phone: string;
  checked_in_at: string | null;
};

export default async function TeamPassesPage({
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
  }>(`select id, name, college, track, payment_verified, payment_ref from teams where id = $1`, [id]);

  if (!team) notFound();

  const participants = await q<Participant>(
    `select id, name, email, phone, checked_in_at from participants
      where team_id = $1 order by is_leader desc, name`,
    [team.id],
  );

  const origin = await baseUrl();
  const passes = await Promise.all(
    participants.map(async (participant) => ({
      ...participant,
      token: await signQrToken(participant.id),
    })),
  );

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
              {team.track ? ` · ${team.track}` : ""} · {participants.length} participants
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
          </div>
        </div>
      </div>

      <div className="print-grid grid gap-4 sm:grid-cols-2">
        {passes.map((participant) => {
          const passUrl = `${origin}/pass/${participant.token}`;
          return (
            <article key={participant.id} className="card-pad print-item break-inside-avoid">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-spark-700">
                    CODE SPARK 2026
                  </p>
                  <h2 className="mt-1 truncate text-lg font-bold text-ink-900">{participant.name}</h2>
                  <p className="truncate text-sm text-ink-600">{team.name}</p>
                  <p className="text-xs text-ink-400">{team.college ?? ""}</p>
                  <dl className="mt-3 space-y-1 text-xs text-ink-600">
                    <div>
                      <dt className="inline font-semibold">Email: </dt>
                      <dd className="inline">{participant.email}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Phone: </dt>
                      <dd className="inline">{participant.phone}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Checked in: </dt>
                      <dd className="inline">
                        {participant.checked_in_at ? fmtDateTime(participant.checked_in_at) : "not yet"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <QrPass value={passUrl} size={150} className="shrink-0 rounded-lg ring-1 ring-ink-200" />
              </div>
              <input
                readOnly
                value={passUrl}
                className="input mt-3 select-all font-mono text-[11px] text-ink-600 no-print"
                aria-label={`Pass link for ${participant.name}`}
              />
              <p className="mt-1 hidden font-mono text-[10px] text-ink-500 print:block">{passUrl}</p>
            </article>
          );
        })}
      </div>

      <p className="text-xs text-ink-500 no-print">
        Every pass is an HMAC-signed token for one participant. Send the link by WhatsApp or email
        from the tech desk; printing this page gives paper backups for the check-in desk.
      </p>
    </div>
  );
}
