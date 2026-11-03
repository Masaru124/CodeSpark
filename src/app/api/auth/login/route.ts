import { fail, json, rateLimit, readJson, clientIp } from "@/lib/api";
import { one } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { createSession, homeFor } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = await rateLimit(
    `login:${clientIp(request)}`,
    Number(process.env.LOGIN_RATE_LIMIT_PER_MIN) || 12,
  );
  if (!limit.ok) return fail("Too many attempts. Wait a minute.", 429);

  const body = await readJson(request);
  const mode = String(body.mode ?? "");

  try {
    if (mode === "admin") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!email || !password) return fail("Email and password are required");

      const admin = await one<{ id: string; password_hash: string; active: boolean }>(
        `select id, password_hash, active from admin_users where email = $1`,
        [email],
      );
      // Always run a hash comparison so response timing does not reveal accounts.
      const stored = admin?.password_hash ?? "pbkdf2$120000$AAAA$AAAA";
      const valid = await verifyPassword(password, stored);
      if (!admin || !admin.active || !valid) return fail("Invalid email or password", 401);

      await createSession("admin", admin.id, email);
      return json({ ok: true, redirectTo: homeFor("admin") });
    }

    if (mode === "judge" || mode === "volunteer") {
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!code) return fail("Code is required");

      if (mode === "judge") {
        const judge = await one<{ id: string; name: string }>(
          `select id, name from judges where invite_code = $1 and active = true`,
          [code],
        );
        if (!judge) return fail("Unknown or inactive judge code", 401);
        await createSession("judge", judge.id, judge.name);
        return json({ ok: true, redirectTo: homeFor("judge") });
      }

      const volunteer = await one<{ id: string; name: string }>(
        `select id, name from volunteers where code = $1 and active = true`,
        [code],
      );
      if (!volunteer) return fail("Unknown or inactive volunteer code", 401);
      await createSession("volunteer", volunteer.id, volunteer.name);
      return json({ ok: true, redirectTo: homeFor("volunteer") });
    }

    return fail("Unknown login mode");
  } catch (error) {
    console.error("login failed", error);
    return fail("Sign-in is unavailable right now", 500);
  }
}
