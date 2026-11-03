import Link from "next/link";
import { getConfig } from "@/lib/config";
import { dbConfigured } from "@/lib/db";
import { fmtDate, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = dbConfigured();
  const config = configured ? await getConfig() : null;
  const event = config?.event;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="container-page flex h-16 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-spark-600 text-lg font-black text-white">
              ⚡
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight text-ink-900">Code Spark Ops</p>
              <p className="text-xs text-ink-500">Event operations console</p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/results" className="btn-ghost">
              Results
            </Link>
            <Link href="/login" className="btn-primary">
              Staff login
            </Link>
          </nav>
        </div>
      </header>

      <section className="container-page py-14">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p className="badge-info">
              {event?.name ?? "CODE SPARK 2026"} · {fmtDate(event?.starts_at ?? "2026-11-12T08:30:00+05:30")}
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-ink-900 sm:text-5xl">
              Fast check-in.
              <br />
              Meals counted once.
              <br />
              <span className="text-spark-600">Judging you can audit.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-600">
              One console for the people running the day: signed QR passes, duplicate-proof meal
              scans, deadline-enforced submissions and per-judge score sheets that keep working
              when the Wi-Fi doesn&apos;t.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/login" className="btn-primary">
                Open staff console
              </Link>
              <Link href="/results" className="btn-secondary">
                Public leaderboard
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-3">
              {[
                ["2–4", "participants / team"],
                ["3", "meals tracked"],
                ["4", "rubric criteria"],
              ].map(([value, label]) => (
                <div key={label} className="stat">
                  <dd className="text-xl font-bold text-ink-900">{value}</dd>
                  <dt className="mt-0.5 text-xs text-ink-500">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="card-pad">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Event day</h2>
            <ol className="mt-4 space-y-3 text-sm">
              {[
                ["08:30", "Check-in desks open", "Signed QR scanned; duplicate scans flagged"],
                ["09:40", "Hacking starts", "First-commit timestamps begin"],
                ["13:00", "Lunch scan", "One serving per participant per meal"],
                ["17:30", "Submission cutoff", "Server-enforced, no exceptions"],
                ["17:30", "Screening round", "Two judges per team, live progress"],
                ["18:15", "Finalists announced", "Top teams by weighted rubric"],
                ["20:50", "Results published", "Public leaderboard + team score sheets"],
              ].map(([time, title, detail]) => (
                <li key={`${time}-${title}`} className="flex gap-3">
                  <span className="w-14 shrink-0 font-mono text-xs font-semibold text-spark-700">
                    {time}
                  </span>
                  <span>
                    <span className="font-semibold text-ink-900">{title}</span>
                    <span className="block text-xs text-ink-500">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-5 rounded-xl bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
              Held at {event?.venue ?? "AMC Engineering College, Bengaluru"} · hacking starts{" "}
              {fmtTime(event?.hack_start)}. Every team can view its own score sheet after publish.
            </p>
          </div>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Admin", "Import teams, verify payments, assign judges, publish results."],
            ["Volunteer", "Phone scanner for check-in and each meal, works offline."],
            ["Judge", "Assigned teams, rubric scores, queued sync when offline."],
            ["Participant", "QR pass, rules, submission links, own scores."],
          ].map(([role, description]) => (
            <div key={role} className="card-pad">
              <p className="text-sm font-bold text-ink-900">{role}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{description}</p>
            </div>
          ))}
        </div>

        {!configured ? (
          <div className="mt-10 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong className="font-semibold">Database not configured.</strong> Set{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code> to
            your Neon connection string, then run{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">npm run db:migrate</code>.
          </div>
        ) : null}
      </section>

      <footer className="border-t border-ink-200 bg-white py-6">
        <div className="container-page flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <p>Code Spark Ops · built for CODE SPARK 2026</p>
          <p>Printed backup lists remain the fallback for every critical path.</p>
        </div>
      </footer>
    </main>
  );
}
