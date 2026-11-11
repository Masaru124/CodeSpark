import Link from "next/link";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Overview"],
  ["/admin/teams", "Teams & passes"],
  ["/admin/import", "Import"],
  ["/admin/staff", "Judges & volunteers"],
  ["/admin/judging", "Judging"],
  ["/admin/repos", "Repos"],
  ["/admin/results", "Results"],
  ["/admin/report", "Report"],
  ["/admin/export", "Export"],
  ["/admin/audit", "Audit log"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("admin");

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-spark-600 text-lg font-black text-white">
              ⚡
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-ink-900">Code Spark Ops</p>
              <p className="text-xs text-ink-500">Admin · {session.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/volunteer" className="btn-secondary hidden sm:inline-flex">
              Scanner
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <nav className="container-page -mb-px flex gap-1 overflow-x-auto pb-0">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-medium text-ink-600 hover:border-spark-500 hover:text-ink-900"
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="container-page py-7">{children}</main>
    </div>
  );
}
