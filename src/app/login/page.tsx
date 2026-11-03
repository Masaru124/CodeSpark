import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/session";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(homeFor(session.role));
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-spark-600 text-lg font-black text-white">
            ⚡
          </span>
          <span className="text-sm font-bold text-ink-900">Code Spark Ops</span>
        </Link>

        <div className="card-pad">
          <h1 className="text-xl font-bold text-ink-900">Staff login</h1>
          <p className="mt-1 text-sm text-ink-600">
            Admins use their email and password. Judges and volunteers use the code from the tech
            desk.
          </p>
          <LoginForm next={next} />
        </div>

        <p className="mt-5 text-center text-xs text-ink-500">
          Participants do not log in — their signed QR pass link opens their page.{" "}
          <Link href="/results" className="link">
            Public results
          </Link>
        </p>
      </div>
    </main>
  );
}
