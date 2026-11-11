import Link from "next/link";
import LiveRefresh from "@/components/LiveRefresh";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function JudgeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("judge");
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="container-page flex h-14 items-center justify-between">
          <div>
            <p className="text-sm font-bold text-ink-900">⚡ Code Spark judging</p>
            <p className="text-xs text-ink-500">{session.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/judge" className="text-xs font-semibold text-spark-700">
              My teams
            </Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn-ghost text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <LiveRefresh />
      <main className="container-page py-6">{children}</main>
    </div>
  );
}
