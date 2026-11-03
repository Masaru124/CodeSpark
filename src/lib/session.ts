import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { one, q } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";

export type Role = "admin" | "judge" | "volunteer";

export type Session = {
  id: string;
  role: Role;
  subjectId: string | null;
  label: string;
};

export const SESSION_COOKIE = "cs_session";
const SESSION_HOURS = 14;

// Under a burst every authenticated request would otherwise spend a database
// round trip just proving who the caller is. A very short per-isolate cache
// removes that query from the hot path; logout clears it explicitly.
const SESSION_CACHE_TTL_MS = 5_000;
const SESSION_CACHE_MAX = 2_000;
const sessionCache = new Map<string, { session: Session; at: number }>();

export async function createSession(role: Role, subjectId: string | null, label: string) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  await q(
    `insert into sessions (token_hash, role, subject_id, label, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [tokenHash, role, subjectId, label, expiresAt.toISOString()],
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = await sha256Hex(token);
    sessionCache.delete(tokenHash);
    await q(`delete from sessions where token_hash = $1`, [tokenHash]);
  }
  store.delete(SESSION_COOKIE);
}

/** Memoised per request so a page can call it in several places for free. */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);

  const cached = sessionCache.get(tokenHash);
  if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS) return cached.session;

  const row = await one<Session & { expires_at: string }>(
    `select id, role, subject_id as "subjectId", label, expires_at
       from sessions where token_hash = $1 and expires_at > now()`,
    [tokenHash],
  );
  if (!row) {
    sessionCache.delete(tokenHash);
    return null;
  }
  const session: Session = { id: row.id, role: row.role, subjectId: row.subjectId, label: row.label };
  if (sessionCache.size >= SESSION_CACHE_MAX) sessionCache.clear();
  sessionCache.set(tokenHash, { session, at: Date.now() });
  return session;
});

/** For server components: bounce to /login when the role does not match. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/")}`);
  if (roles.length > 0 && !roles.includes(session.role)) {
    redirect(homeFor(session.role));
  }
  return session;
}

/** For route handlers: null means "respond 401 yourself". */
export async function apiRole(...roles: Role[]): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  if (roles.length > 0 && !roles.includes(session.role)) return null;
  return session;
}

export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "judge") return "/judge";
  return "/volunteer";
}
