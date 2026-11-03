#!/usr/bin/env node
/**
 * Browser-side timing: what a single real user waits for, page by page.
 * Measures TTFB, DOMContentLoaded, load, transferred bytes and JS weight.
 *
 *   node scripts/perf-browser.mjs
 */
import { chromium } from "playwright";
import { loadEnv } from "./env.mjs";

loadEnv();

const BASE = process.env.BASE_URL || "http://localhost:3000";
const COOKIE = "cs_session";

async function login(request, body) {
  const response = await request.post(`${BASE}/api/auth/login`, { data: body });
  if (!response.ok()) return null;
  const header = (await response.headers())["set-cookie"] ?? "";
  return new RegExp(`${COOKIE}=([^;]+)`).exec(header)?.[1] ?? null;
}

const browser = await chromium.launch();
const results = [];

async function measure(context, path, label) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60_000 });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const js = resources.filter((entry) => entry.name.endsWith(".js"));
    return {
      ttfb: nav.responseStart,
      dcl: nav.domContentLoadedEventEnd,
      load: nav.loadEventEnd,
      transferKB: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024,
      jsKB: js.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024,
      jsCount: js.length,
    };
  });
  results.push({ label, ...timing });
  await page.close();
  return timing;
}

const anon = await browser.newContext();
const adminContext = await browser.newContext();
const volunteerContext = await browser.newContext();

const adminSession = await login(adminContext.request, {
  mode: "admin",
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
if (adminSession) await adminContext.addCookies([{ name: COOKIE, value: adminSession, url: BASE }]);

const codes = await adminContext.request.get(`${BASE}/api/scan/roster`).catch(() => null);
void codes;

// Find a pass link from the first team page, then use it anonymously.
let passPath = null;
if (adminSession) {
  const page = await adminContext.newPage();
  await page.goto(`${BASE}/admin/teams`, { waitUntil: "load" });
  await page.getByRole("link", { name: "Passes", exact: true }).first().click();
  await page.waitForLoadState("load");
  const href = await page.getByLabel(/^Pass link for/).first().getAttribute("value");
  passPath = href ? new URL(href).pathname : null;
  await page.close();
}

await measure(anon, "/", "home (anon)");
await measure(anon, "/results", "results (anon)");
await measure(anon, "/login", "login (anon)");
if (passPath) await measure(anon, passPath, "participant pass (anon)");
if (adminSession) await measure(adminContext, "/admin", "admin overview");
if (adminSession) await measure(adminContext, "/admin/teams", "teams list");
if (adminSession) await measure(adminContext, "/admin/repos", "repo tracker");

console.log("");
console.table(
  results.map((row) => ({
    page: row.label,
    "ttfb ms": Math.round(row.ttfb),
    "dcl ms": Math.round(row.dcl),
    "load ms": Math.round(row.load),
    "transfer kB": Math.round(row.transferKB),
    "js kB": Math.round(row.jsKB),
    "js files": row.jsCount,
  })),
);

await browser.close();
