import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Minimal .env.local reader so the suite can log in without printing secrets. */
function readLocalEnv(): Record<string, string> {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const entries = raw
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^["']|["']$/g, ""),
        ] as const;
      });
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export const localEnv = readLocalEnv();

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? localEnv.ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? localEnv.ADMIN_PASSWORD ?? "";
