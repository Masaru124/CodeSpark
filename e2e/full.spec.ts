import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./env";

/**
 * End-to-end coverage of every surface and every primary control:
 * public pages, admin console, volunteer scanner, judge scoring, participant pass.
 * Runs against a real server + real database (demo data).
 */

let judgeCode = "";
let volunteerCode = "";
let passToken = "";
let passName = "";

async function admin(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { mode: "admin", email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(response.status(), "admin login via API").toBe(200);
}

async function loginWithCode(page: Page, mode: "judge" | "volunteer", code: string) {
  const response = await page.request.post("/api/auth/login", { data: { mode, code } });
  expect(response.status(), `${mode} code login`).toBe(200);
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await admin(page);

  await page.goto("/admin/staff");
  judgeCode = (await page.locator("table").first().locator("tbody tr").first().locator("code").innerText()).trim();
  volunteerCode = (await page.locator("table").nth(1).locator("tbody tr").first().locator("code").innerText()).trim();

  await page.goto("/admin/teams");
  await page.getByRole("link", { name: "Passes", exact: true }).first().click();
  const passLink = page.getByLabel(/^Pass link for/).first();
  const passLinkValue = (await passLink.getAttribute("value")) ?? "";
  passToken = /\/pass\/(\S+)$/.exec(passLinkValue)?.[1] ?? "";
  passName = ((await passLink.getAttribute("aria-label")) ?? "").replace("Pass link for ", "");

  expect(judgeCode, "captured judge code").toMatch(/^[A-Z0-9]{6}$/);
  expect(volunteerCode, "captured volunteer code").toMatch(/^[A-Z0-9]{6}$/);
  expect(passToken, "captured pass token").toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{22}$/);
  await context.close();
});

// ------------------------------------------------------------------ public
test.describe("public pages", () => {
  test("home page renders and links to staff login", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Fast check-in");
    await expect(page.getByText("CODE SPARK 2026").first()).toBeVisible();
    await page.getByRole("link", { name: "Staff login" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Staff login" })).toBeVisible();
  });

  test("results stay locked until published", async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByRole("heading", { name: "Results not announced yet" })).toBeVisible();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL("/");
  });

  test("login switches modes and rejects a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Judge" }).click();
    await expect(page.getByLabel("Judge code")).toBeVisible();
    await page.getByRole("button", { name: "Volunteer" }).click();
    await expect(page.getByLabel("Volunteer code")).toBeVisible();
    await page.getByRole("button", { name: "Admin" }).click();

    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("forged pass token shows a friendly error", async ({ page }) => {
    await page.goto(`/pass/${"a".repeat(32)}.${"b".repeat(22)}`);
    await expect(page.getByText(/not valid/i)).toBeVisible();
  });

  test("signed-out staff pages redirect to login and the scan API is closed", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/volunteer");
    await expect(page).toHaveURL(/\/login/);

    const response = await page.request.post("/api/scan", {
      data: { mode: "checkin", items: [{ token: passToken }] },
    });
    expect(response.status()).toBe(401);
  });
});

// ------------------------------------------------------------------- admin
test.describe("admin console", () => {
  test("UI login lands on the overview", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Event overview" })).toBeVisible();
    await expect(page.getByText("Participants", { exact: true })).toBeVisible();
  });

  test("every admin navigation link works", async ({ page }) => {
    await admin(page);
    await page.goto("/admin");
    const nav: Array<[string, string]> = [
      ["Teams & passes", "Teams & passes"],
      ["Import", "Import registration CSV"],
      ["Judges & volunteers", "Judges & volunteers"],
      ["Judging", "Judging"],
      ["Repos", "Repo tracker"],
      ["Results", "Results"],
      ["Audit log", "Audit log"],
      ["Overview", "Event overview"],
    ];
    for (const [link, heading] of nav) {
      await page.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });

  test("team search filters and the pass sheet shows signed QRs", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/teams");
    await page.getByLabel("Search teams").fill("Aqua");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: /Aqua/ }).first()).toBeVisible();

    await page.getByRole("link", { name: "Passes", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Print passes" })).toBeVisible();
    expect(await page.locator("svg").count()).toBeGreaterThan(0);
    const link = page.getByLabel(/^Pass link for/).first();
    await expect(link).toHaveValue(/\/pass\/[0-9a-f]{32}\./);
    await expect(page.getByText("Checked in:", { exact: false }).first()).toBeVisible();
  });

  test("payment verification toggles and reverts", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/teams");

    // Scope to one team's row by its unique link, because the list re-sorts by payment state.
    const href = (await page.locator("table tbody tr td a").first().getAttribute("href"))!;
    const row = page.locator(`tr:has(a[href="${href}"])`);
    const wasVerified = (await row.getByText(/^(Verified|Pending)$/).first().innerText()).trim() === "Verified";

    await row.getByRole("button", { name: wasVerified ? "Unverify" : "Verify" }).click();
    await expect(page).toHaveURL(/ok=/);
    await expect(
      page.locator(`tr:has(a[href="${href}"])`).getByText(wasVerified ? "Pending" : "Verified"),
    ).toBeVisible();

    await page
      .locator(`tr:has(a[href="${href}"])`)
      .getByRole("button", { name: wasVerified ? "Verify" : "Unverify" })
      .click();
    await expect(page).toHaveURL(/ok=/);
    await expect(
      page.locator(`tr:has(a[href="${href}"])`).getByText(wasVerified ? "Verified" : "Pending"),
    ).toBeVisible();
  });

  test("staff can be added, disabled and re-enabled", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/staff");

    const suffix = Date.now().toString().slice(-7);
    const judgeName = `E2E Judge ${suffix}`;
    const volunteerName = `E2E Desk ${suffix}`;

    await page.getByLabel("Name", { exact: true }).first().fill(judgeName);
    await page.getByLabel("Email (optional)").fill(`e2e.${suffix}@example.com`);
    await page.getByRole("button", { name: "Add judge" }).click();
    await expect(page).toHaveURL(/ok=/);
    const judgeRow = page.getByRole("row", { name: new RegExp(judgeName) });
    await expect(judgeRow).toBeVisible();
    await expect(judgeRow.locator("code")).toHaveText(/^[A-Z0-9]{6}$/);

    await page.getByLabel("Name", { exact: true }).nth(1).fill(volunteerName);
    await page.getByRole("button", { name: "Add volunteer" }).click();
    await expect(page).toHaveURL(/ok=/);
    const volunteerRow = page.getByRole("row", { name: new RegExp(volunteerName) });
    await expect(volunteerRow).toBeVisible();

    await judgeRow.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("row", { name: new RegExp(judgeName) }).getByText("Disabled")).toBeVisible();
    await page.getByRole("row", { name: new RegExp(judgeName) }).getByRole("button", { name: "Enable" }).click();
    await expect(page.getByRole("row", { name: new RegExp(judgeName) }).getByText("Active")).toBeVisible();
  });

  test("CSV import creates a new team", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/import");
    await page.getByLabel("…or paste CSV").fill(
      [
        "team_name,participant_name,email,phone,college,track",
        "E2E Robotics,Playwright One,e2e.one@example.com,9000000001,E2E College,AI/ML",
        "E2E Robotics,Playwright Two,e2e.two@example.com,9000000002,E2E College,AI/ML",
      ].join("\n"),
    );
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page).toHaveURL(/ok=/);

    await page.goto("/admin/teams?q=E2E");
    await expect(page.getByRole("link", { name: "E2E Robotics" })).toBeVisible();
  });

  test("auto-assign runs and coverage stays consistent", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/judging");
    await page.getByRole("button", { name: "Run assignment" }).click();
    await expect(page).toHaveURL(/ok=/);
    await expect(page.getByRole("heading", { name: "Coverage by team" })).toBeVisible();
    await expect(page.getByText(/screening sheets complete/)).toBeVisible();
  });

  test("repo tracker syncs one repo and a batch", async ({ page }) => {
    test.setTimeout(150_000);
    await admin(page);
    await page.goto("/admin/repos");
    await expect(page.getByRole("heading", { name: "Repo tracker" })).toBeVisible();

    // GitHub's anonymous quota is 60 requests/hour, so by a later run the sync legitimately
    // returns 403. A clear rate-limit flash is a pass; a crash or a silent no-op is not.
    await page.getByRole("button", { name: "Sync", exact: true }).first().click();
    await expect(page).toHaveURL(/(ok|error)=/);
    await expect(page.locator("main")).toContainText(/commit|rate limit|GitHub returned/i);

    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page).toHaveURL(/(ok|error)=/);
    await expect(
      page.getByText(/Synced \d+\/\d+ repositories|rate limit|GitHub returned/i).first(),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Latest commits" })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toBeVisible();
  });

  test("CSV export downloads a file", async ({ page }) => {
    await admin(page);
    await page.goto("/admin/results");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export rankings" }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("rankings");
  });

  test("publish unlocks the public board, unpublish locks it again", async ({ page }) => {
    await admin(page);
    try {
      await page.goto("/admin/results");
      await page.getByRole("button", { name: "Publish results" }).click();
      await expect(page).toHaveURL(/ok=/);

      await page.goto("/results");
      await expect(page.getByText("Final standings")).toBeVisible();
      await expect(page.getByRole("heading", { name: /winners/i })).toBeVisible();
      await expect(page.getByText("#1")).toBeVisible();
    } finally {
      await page.goto("/admin/results");
      const unpublish = page.getByRole("button", { name: "Unpublish" });
      if (await unpublish.count()) {
        await unpublish.click();
        await expect(page).toHaveURL(/ok=/);
      }
    }

    await page.goto("/results");
    await expect(page.getByRole("heading", { name: "Results not announced yet" })).toBeVisible();
  });

  test("logout clears the session", async ({ page }) => {
    await admin(page);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});

// --------------------------------------------------------------- volunteer
test.describe("volunteer scanner", () => {
  test("code login opens the scanner", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Volunteer" }).click();
    await page.getByLabel("Volunteer code").fill(volunteerCode);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/volunteer/);
    await expect(page.getByText(/scanner/i).first()).toBeVisible();
    await expect(page.getByText(/passes cached/)).toBeVisible();
  });

  test("modes switch, a pass scans once and a repeat is refused", async ({ page }) => {
    await loginWithCode(page, "volunteer", volunteerCode);
    await page.goto("/volunteer");

    await page.getByRole("button", { name: "Dinner", exact: true }).click();
    await expect(page.getByText("Dinner mode")).toBeVisible();
    await page.getByRole("button", { name: "Snacks", exact: true }).click();
    await expect(page.getByText("Snacks mode")).toBeVisible();

    const form = page.locator("form").filter({ has: page.locator("#manual") });
    await page.locator("#manual").fill(passToken);
    await form.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(page.getByText(passName, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(passName) }).first()).toBeVisible();

    // The scanner ignores a repeat of the same token within 2.5 s, so let that window pass.
    await page.waitForTimeout(2_700);
    await page.locator("#manual").fill(passToken);
    await form.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(page.getByText(/already served/i)).toBeVisible();
  });

  test("name search suggests participants and can scan from the list", async ({ page }) => {
    await loginWithCode(page, "volunteer", volunteerCode);
    await page.goto("/volunteer");
    await page.getByLabel("Find a participant by name").fill("Aqua");
    const suggestion = page.getByRole("button", { name: "Scan", exact: true }).last();
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(page.getByText(/already|✓|saved|Aqua/i).first()).toBeVisible();
  });

  test("camera failure degrades gracefully to manual entry", async ({ page }) => {
    await loginWithCode(page, "volunteer", volunteerCode);
    await page.goto("/volunteer");
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(
      page.getByText(/Camera unavailable|use manual entry|Stop camera/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Manual entry (QR unreadable)")).toBeVisible();
  });
});

// ------------------------------------------------------------------- judge
test.describe("judge scoring", () => {
  test("code login lists assigned teams", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Judge" }).click();
    await page.getByLabel("Judge code").fill(judgeCode);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/judge/);
    await expect(page.getByRole("heading", { name: "My teams" })).toBeVisible();
    await expect(page.getByText(/score sheets complete/)).toBeVisible();
  });

  test("a score sheet saves and survives a reload", async ({ page }) => {
    await loginWithCode(page, "judge", judgeCode);
    await page.goto("/judge");
    await page.locator('a[href^="/judge/"]').first().click();
    await expect(page.getByText(/^(Screening|Finalist round)$/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save score sheet" })).toBeVisible();

    const slider = page.locator("#score-demo");
    await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "9");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByLabel(/Notes for the deliberation/).fill("Playwright check");
    await page.getByRole("button", { name: "Save score sheet" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.locator("#score-demo")).toHaveValue("9");
    await expect(page.getByLabel(/Notes for the deliberation/)).toHaveValue("Playwright check");
    await expect(page.getByText("Sheet complete")).toBeVisible();
  });

  test("a judge cannot open an assignment they do not own", async ({ page }) => {
    await loginWithCode(page, "judge", judgeCode);
    await page.goto("/judge");
    const own = await page.locator('a[href^="/judge/"]').first().getAttribute("href");
    const foreignId = "00000000-0000-4000-8000-000000000000";
    const response = await page.goto(`/judge/${foreignId}`);
    expect(response?.status()).toBe(404);
    expect(own).toMatch(/^\/judge\/[0-9a-f-]{36}$/);
  });
});

// -------------------------------------------------------- participant pass
test.describe("participant pass", () => {
  test("the pass shows a QR, schedule and rules without a login", async ({ page }) => {
    await page.goto(`/pass/${passToken}`);
    await expect(page.getByText("Participant pass")).toBeVisible();
    await expect(page.getByRole("heading", { name: passName })).toBeVisible();
    await expect(page.getByText("Show this at the desk")).toBeVisible();
    expect(await page.locator("svg").count()).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Your schedule" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  });

  test("a participant submits and updates a repository", async ({ page }) => {
    await page.goto(`/pass/${passToken}`);
    const repo = page.getByLabel(/GitHub repository/);
    await repo.fill("https://github.com/vercel/next.js");
    await page.getByLabel("Demo video link").fill("https://youtu.be/e2e-demo");
    await page.getByRole("button", { name: /Submit project|Update submission/ }).click();
    await expect(page).toHaveURL(/ok=|error=/);

    await page.goto(`/pass/${passToken}`);
    await expect(page.getByRole("link", { name: "https://github.com/vercel/next.js" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update submission" })).toBeVisible();
  });

  test("the submission form rejects a non-URL", async ({ page }) => {
    await page.goto(`/pass/${passToken}`);
    await page.getByLabel(/GitHub repository/).fill("not-a-url");
    await page.getByRole("button", { name: /Submit project|Update submission/ }).click();
    await expect(page).toHaveURL(/error=/);
    await expect(page.getByText(/full https:\/\/ URL/)).toBeVisible();
  });
});
