import { createHash, randomUUID } from "node:crypto";
import {
  test,
  expect as baseExpect,
  type Page,
  type Locator,
} from "@playwright/test";
import pg from "pg";
import { FIXTURES, SKILL_CATALOG_GOOD_INSTRUCTIONS } from "../contracts.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
  expectNetworkViolations,
  activeElementInside,
} from "./support.ts";

const expect = baseExpect.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000 });
const workspaceId = FIXTURES.workspaces.personalViewer;
const viewerId = FIXTURES.users.viewer;
type ScanRow = {
  id: string;
  candidateId: string;
  operationId: string;
  status: string;
  mode: string;
  report: { verdict: string };
  contentDigest: string;
  profile: Record<string, unknown>;
  profileFingerprint: string;
};
async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({
    connectionString: process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    return (await client.query<T>(statement, values)).rows;
  } finally {
    await client.end();
  }
}
async function control(value?: object) {
  const response = await fetch(
    `${process.env.ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG_URL}/__fixture/control`,
    {
      method: value ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${process.env.ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG_CONTROL}`,
        "content-type": "application/json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    requests: {
      path: string;
      jobId?: string;
      native?: boolean;
      fault?: string;
    }[];
    profiles: { profiles: Record<string, unknown>[] };
  };
}
async function openCatalog(page: Page) {
  await page.goto(
    "/dashboard?section=skills&workspace=rr-e2e-personal-viewer",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Browse catalog", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Browse skills",
    exact: true,
  });
  await expect(
    dialog.getByRole("searchbox", { name: "Search the catalog" }),
  ).toBeVisible();
  return dialog;
}
async function preview(page: Page, title: string, name: string) {
  const dialog = await openCatalog(page);
  await dialog
    .getByRole("searchbox", { name: "Search the catalog" })
    .fill(title);
  await dialog
    .getByRole("button", { name: `Preview ${title}`, exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  return dialog;
}
async function check(
  dialog: Locator,
  expected = "No issues found",
  timeout = 110_000,
) {
  await dialog
    .getByRole("button", { name: "Check skill", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: new RegExp(`^${expected}$`, "u") }),
  ).toBeVisible({ timeout });
}
async function latestScan(name: string) {
  return (
    await sql<ScanRow>(
      `SELECT scan.* FROM "ReviewSkillScan" scan JOIN "ReviewSkillImportCandidate" candidate ON candidate.id=scan."candidateId" WHERE candidate.name=$1 AND scan."workspaceId"=$2 ORDER BY scan."createdAt" DESC LIMIT 1`,
      [name, workspaceId],
    )
  )[0]!;
}
async function capture(
  dialog: Locator,
  filename: string,
  title = "Browse skills",
) {
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole("button", { name: `Close ${title}`, exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({ path: test.info().outputPath(filename) });
}
async function loseCommittedReply(page: Page, method: string) {
  let lost = false;
  const commands: { input: Record<string, unknown>; actionId: string }[] = [];
  await page.route("**/dashboard?**", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (
      request.method() !== "POST" ||
      !request.headers()["next-action"] ||
      !body.includes(`"${method}"`)
    )
      return route.fallback();
    const command = (
      JSON.parse(body) as { method: string; input: Record<string, unknown> }[]
    )[0]!;
    commands.push({
      input: command.input,
      actionId: request.headers()["next-action"]!,
    });
    if (lost) return route.fallback();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (method === "requestScan") {
      expect(
        await sql(
          `SELECT id FROM "ReviewSkillScan" WHERE "workspaceId"=$1 AND "actorUserId"=$2 AND "operationId"=$3`,
          [workspaceId, viewerId, command.input.operationId],
        ),
      ).toHaveLength(1);
    } else {
      const saved = await sql<{ importedSkillId: string | null }>(
        `SELECT "importedSkillId" FROM "ReviewSkillImportCandidate" WHERE id=$1`,
        [command.input.candidateId],
      );
      expect(saved[0]?.importedSkillId).toBeTruthy();
    }
    lost = true;
    await route.abort("failed");
  });
  return commands;
}

test.describe("Catalog real checked import", () => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_SKILL_CATALOG !== "1",
    "Requires the explicit native Skills catalog fixture lane",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  const violations = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page, context }) => {
    const observed: string[] = [];
    violations.set(page, observed);
    await installLoopbackOnlyNetworkGuard(page, observed);
    await useViewerSession(context);
    // Each scenario gets independent quota state in the guarded disposable DB.
    await sql(`DELETE FROM "RateLimitBucket" WHERE key LIKE 'skill-catalog:%'`);
    await control({ hold: false, partialNext: 0 });
  });
  test.afterEach(async ({ page }) => {
    await control({ hold: false, partialNext: 0 });
    await expectNetworkViolations(violations.get(page) ?? []);
  });

  test("Catalog native static check, same-page progress and exact import continue to existing assignment", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const dialog = await openCatalog(page);
    await expect(
      dialog.getByRole("button", { name: "Load more skills", exact: true }),
    ).toBeVisible();
    await capture(dialog, "skills-catalog-list-desktop.png");
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("f");
    await expect(
      dialog.getByText(
        "Type at least two characters to search. Popular skills are shown below.",
      ),
    ).toBeVisible();
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Focused review");
    await dialog
      .getByRole("button", { name: "Preview Focused review", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "focused-review", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("pre")).toHaveText(
      SKILL_CATALOG_GOOD_INSTRUCTIONS,
    );
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await capture(dialog, "skills-catalog-preview-desktop.png");
    await control({ hold: true });
    await dialog
      .getByRole("button", { name: "Check skill", exact: true })
      .click();
    await expect
      .poll(async () => (await latestScan("focused-review"))?.status)
      .toBe("running");
    await expect(
      dialog.getByText(
        "Checking… You can close this window and return while it finishes.",
      ),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(dialog, "skills-catalog-running-mobile.png");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Browse catalog" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Browse catalog" }).click();
    await expect(
      dialog.getByText(
        "Checking… You can close this window and return while it finishes.",
      ),
    ).toBeVisible();
    await control({ hold: false });
    await expect(
      dialog.getByText("No issues found", { exact: true }),
    ).toBeVisible({ timeout: 110_000 });
    await capture(dialog, "skills-catalog-clear-mobile.png");
    const scanned = await latestScan("focused-review");
    expect(scanned.report.verdict).toBe("clear");
    expect(
      (await control()).requests.filter(
        (entry) =>
          entry.path === "/v1/scans" &&
          entry.jobId === scanned.id &&
          entry.native,
      ),
    ).toHaveLength(1);
    await dialog
      .getByRole("button", { name: "Add to library", exact: true })
      .click();
    const assignment = page.getByRole("dialog", {
      name: "Assign skill to repositories",
      exact: true,
    });
    await expect(assignment).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await assignment
      .getByRole("searchbox", { name: "Search repositories" })
      .fill("skills-project-001");
    await assignment
      .getByRole("checkbox", {
        name: "Select rr-e2e-viewer/skills-project-001",
        exact: true,
      })
      .check();
    await assignment
      .getByRole("button", { name: "Assign to 1 repository", exact: true })
      .click();
    await expect(assignment.getByRole("status")).toContainText("1 added");
    await capture(
      assignment,
      "skills-catalog-assignment-mobile.png",
      "Assign skill to repositories",
    );
    const saved = await sql<{
      name: string;
      description: string;
      instructions: string;
      canonicalText: string;
      contentDigest: string;
      count: number;
    }>(
      `SELECT revision.name,revision.description,revision.instructions,candidate."canonicalText",candidate."contentDigest",(SELECT count(*)::int FROM "ReviewSkillBinding" WHERE "skillId"=candidate."importedSkillId") AS count FROM "ReviewSkillImportCandidate" candidate JOIN "ReviewSkill" skill ON skill.id=candidate."importedSkillId" JOIN "ReviewSkillRevision" revision ON revision.id=skill."headRevisionId" WHERE candidate.id=$1`,
      [scanned.candidateId],
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.instructions).toBe(SKILL_CATALOG_GOOD_INSTRUCTIONS);
    expect(saved[0]!.canonicalText).toBe(
      `---\nname: ${JSON.stringify(saved[0]!.name)}\ndescription: ${JSON.stringify(saved[0]!.description)}\n---\n${saved[0]!.instructions}`,
    );
    expect(saved[0]!.contentDigest).toBe(
      `sha256:${createHash("sha256").update(saved[0]!.canonicalText).digest("hex")}`,
    );
    expect(saved[0]!.count).toBe(1);
  });

  test("Catalog AI choice requires its own native check before importing the same preview", async ({
    page,
  }) => {
    // One static check plus the separate AI profile's bounded 180-second job.
    test.setTimeout(300_000);
    const dialog = await preview(page, "AI review", "ai-review");
    await check(dialog);
    const staticScan = await latestScan("ai-review");
    expect(staticScan.mode).toBe("static");
    await dialog
      .getByRole("checkbox", { name: /^Include AI-assisted analysis/ })
      .check();
    await expect(
      dialog.getByText(
        "The instructions will be sent to the configured analysis service.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("No issues found", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await check(dialog, "No issues found", 190_000);
    const aiScan = await latestScan("ai-review");
    expect(aiScan.mode).toBe("ai");
    expect(aiScan.id).not.toBe(staticScan.id);
    expect(aiScan.profileFingerprint).not.toBe(staticScan.profileFingerprint);
    expect(aiScan.contentDigest).toBe(staticScan.contentDigest);
    expect(aiScan.report.verdict).toBe("clear");
    expect(
      (await control()).requests.filter(
        (entry) =>
          entry.path === "/v1/scans" &&
          entry.jobId === aiScan.id &&
          entry.native,
      ),
    ).toHaveLength(1);
    await capture(dialog, "skills-catalog-ai-clear-desktop.png");
    await dialog.getByRole("button", { name: "Add to library" }).click();
    await expect(
      page.getByRole("dialog", { name: "Assign skill to repositories" }),
    ).toBeVisible();
    const saved = (
      await sql<{ importedScanId: string; importedSkillId: string }>(
        `SELECT "importedScanId","importedSkillId" FROM "ReviewSkillImportCandidate" WHERE id=$1`,
        [aiScan.candidateId],
      )
    )[0]!;
    expect(saved.importedScanId).toBe(aiScan.id);
    expect(saved.importedSkillId).toBeTruthy();
  });

  test("Catalog lost admitted scan reply retries the same job and quota after reopening", async ({
    page,
  }) => {
    const dialog = await preview(page, "Retry review", "retry-review");
    const commands = await loseCommittedReply(page, "requestScan");
    await dialog
      .getByRole("button", { name: "Check skill", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry check", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Browse catalog", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Retry check", exact: true })
      .click();
    await expect(
      dialog.getByText("No issues found", { exact: true }),
    ).toBeVisible({ timeout: 110_000 });
    expect(commands).toHaveLength(2);
    expect(commands[1]!.input).toEqual(commands[0]!.input);
    expect(
      await sql(
        `SELECT id FROM "ReviewSkillScan" WHERE "operationId"=$1 AND "actorUserId"=$2`,
        [commands[0]!.input.operationId, viewerId],
      ),
    ).toHaveLength(1);
    expect(
      (
        await sql<{ count: number }>(
          `SELECT count FROM "RateLimitBucket" WHERE key=$1`,
          [`skill-catalog:jobs:static:user:${viewerId}`],
        )
      )[0]!.count,
    ).toBe(1);
  });

  test("Catalog lost committed import reply recovers one original without changing its submitted intent", async ({
    page,
  }) => {
    const dialog = await preview(
      page,
      "Import retry review",
      "import-retry-review",
    );
    await check(dialog);
    const commands = await loseCommittedReply(page, "importCandidate");
    await dialog
      .getByRole("button", { name: "Add to library", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry adding", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Back to results", exact: true }),
    ).toBeDisabled();
    await capture(dialog, "skills-catalog-import-uncertain-desktop.png");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Browse catalog", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Retry adding", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", {
        name: "Assign skill to repositories",
        exact: true,
      }),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[1]!.input).toEqual(commands[0]!.input);
    expect(
      await sql(
        `SELECT id FROM "ReviewSkill" WHERE "createOperationId"=$1 AND "authorUserId"=$2`,
        [commands[0]!.input.candidateId, viewerId],
      ),
    ).toHaveLength(1);
  });

  test("Catalog partial scanner report fails closed and a deliberate retry creates a new bounded attempt", async ({
    page,
  }) => {
    const dialog = await preview(page, "Partial review", "partial-review");
    await control({ partialNext: 1 });
    await check(dialog, "Could not complete check");
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await capture(dialog, "skills-catalog-incomplete-desktop.png");
    const first = await latestScan("partial-review");
    await dialog
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await expect(
      dialog.getByText("No issues found", { exact: true }),
    ).toBeVisible({ timeout: 110_000 });
    const second = await latestScan("partial-review");
    expect(second.id).not.toBe(first.id);
    expect(second.operationId).not.toBe(first.operationId);
    expect(
      (await control()).requests.filter(
        (entry) =>
          entry.jobId === first.id &&
          entry.fault === "partial_report_after_native_execution",
      ),
    ).toHaveLength(1);
  });

  test("Catalog warning and text-only acknowledgements are explicit before import", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await preview(page, "Metadata review", "metadata-review");
    await check(dialog, "Review warnings");
    await dialog.getByText(/^Show findings \(\d+\)$/).click();
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await dialog
      .getByRole("checkbox", {
        name: "I reviewed the warnings and want to add this skill.",
        exact: true,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await dialog
      .getByRole("checkbox", {
        name: /I understand that only these text instructions will be added/,
      })
      .check();
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeEnabled();
    await capture(dialog, "skills-catalog-warnings-mobile.png");
    await dialog
      .getByRole("button", { name: "Add to library", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Assign skill to repositories" }),
    ).toBeVisible();
    const row = (
      await sql<{
        omittedFields: string[];
        canonicalText: string;
        importedSkillId: string;
      }>(
        `SELECT "omittedFields","canonicalText","importedSkillId" FROM "ReviewSkillImportCandidate" WHERE name='metadata-review' ORDER BY "createdAt" DESC LIMIT 1`,
      )
    )[0]!;
    expect(row.omittedFields).toEqual(["license", "metadata"]);
    expect(row.canonicalText).not.toContain("Fixture author");
    expect(row.importedSkillId).toBeTruthy();
  });

  test("Catalog native dangerous content blocks import and markup preview remains inert", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await preview(page, "Unsafe review", "unsafe-review");
    await check(dialog, "Risk found");
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    await capture(dialog, "skills-catalog-blocked-mobile.png");
    expect((await latestScan("unsafe-review")).report.verdict).toBe("blocked");
    await dialog.getByRole("button", { name: "Back to results" }).click();
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Markup review");
    await dialog.getByRole("button", { name: "Preview Markup review" }).click();
    await expect(dialog.locator("pre")).toContainText(
      "<script>globalThis.catalogPreviewExecuted = true</script>",
    );
    expect(
      await page.evaluate(() =>
        Object.hasOwn(globalThis, "catalogPreviewExecuted"),
      ),
    ).toBe(false);
    await capture(dialog, "skills-catalog-inert-preview-mobile.png");
  });

  test("Catalog immutable source choice, unsupported companions and incomplete discovery stay understandable", async ({
    page,
  }) => {
    const dialog = await openCatalog(page);
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Ambiguous review");
    await dialog
      .getByRole("button", { name: "Preview Ambiguous review" })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Choose the skill to preview" }),
    ).toBeVisible();
    await capture(dialog, "skills-catalog-source-choice-desktop.png");
    await dialog.getByRole("button", { name: "Choose Second review" }).click();
    await expect(
      dialog.getByRole("heading", { name: "ambiguous-two", exact: true }),
    ).toBeVisible();
    const selected = (
      await sql<{ sourceCommit: string; sourcePath: string }>(
        `SELECT "sourceCommit","sourcePath" FROM "ReviewSkillImportCandidate" WHERE name='ambiguous-two' ORDER BY "createdAt" DESC LIMIT 1`,
      )
    )[0]!;
    expect(selected).toEqual({
      sourceCommit: "1".repeat(40),
      sourcePath: "ambiguous-two",
    });
    await dialog.getByRole("button", { name: "Back to results" }).click();
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Companion review");
    await dialog
      .getByRole("button", { name: "Preview Companion review" })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "This skill cannot be added as text instructions.",
    );
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back to results" }).click();
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Unavailable review");
    await dialog
      .getByRole("button", { name: "Preview Unavailable review" })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "The skill could not be fully opened.",
    );
    await capture(dialog, "skills-catalog-source-incomplete-desktop.png");
  });

  test("Catalog authority loss prevents a check and removes the private preview", async ({
    page,
    context,
  }) => {
    const dialog = await preview(page, "Auth review", "auth-review");
    await useOtherSession(context);
    await dialog
      .getByRole("button", { name: "Check skill", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "Your access changed. Sign in or refresh this page before continuing.",
      ),
    ).toBeVisible();
    await expect(dialog.locator("pre")).toHaveCount(0);
    expect(
      await sql(
        `SELECT scan.id FROM "ReviewSkillScan" scan JOIN "ReviewSkillImportCandidate" candidate ON candidate.id=scan."candidateId" WHERE candidate.name='auth-review'`,
      ),
    ).toHaveLength(0);
  });

  test("Catalog rate refusal retains selection and retries without an upstream resolve", async ({
    page,
  }) => {
    const dialog = await openCatalog(page);
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Quota review");
    await expect(
      dialog.getByRole("button", { name: "Preview Quota review" }),
    ).toBeVisible();
    await sql(
      `INSERT INTO "RateLimitBucket" (key,count,"limit","windowStart","windowEndsAt","createdAt","updatedAt") VALUES ($1,6,6,date_trunc('minute',clock_timestamp()),clock_timestamp()+interval '1 minute',clock_timestamp(),clock_timestamp()) ON CONFLICT (key) DO UPDATE SET count=6,"windowEndsAt"=clock_timestamp()+interval '1 minute'`,
      [`skill-catalog:request:resolve:user:${viewerId}`],
    );
    const before = (await control()).requests.filter(
      (entry) => entry.path === "/v1/skills/resolve",
    ).length;
    await dialog.getByRole("button", { name: "Preview Quota review" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Too many requests. Try again in",
    );
    expect(
      (await control()).requests.filter(
        (entry) => entry.path === "/v1/skills/resolve",
      ),
    ).toHaveLength(before);
    await capture(dialog, "skills-catalog-rate-limit-desktop.png");
    await sql(`DELETE FROM "RateLimitBucket" WHERE key=$1`, [
      `skill-catalog:request:resolve:user:${viewerId}`,
    ]);
    await dialog
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "quota-review", exact: true }),
    ).toBeVisible();
  });

  test("Catalog expired historical check cannot authorize adding even through a direct action", async ({
    page,
  }) => {
    const dialog = await preview(page, "Expired review", "expired-review");
    const profiles = (await control()).profiles.profiles;
    const profile = profiles.find((value) => value.mode === "static")!;
    let actionId = "",
      candidateId = "",
      scanId = "";
    await page.route("**/dashboard?**", async (route) => {
      const request = route.request(),
        body = request.postData() ?? "";
      if (
        scanId ||
        request.method() !== "POST" ||
        !request.headers()["next-action"] ||
        !body.includes('"requestScan"')
      )
        return route.fallback();
      const command = (
        JSON.parse(body) as {
          input: { candidateId: string; operationId: string; mode: string };
        }[]
      )[0]!.input;
      actionId = request.headers()["next-action"]!;
      candidateId = command.candidateId;
      scanId = randomUUID();
      // Seed a historical terminal receipt. Immutable production rows are never edited.
      await sql(
        `INSERT INTO "ReviewSkillScan" (id,"workspaceId","actorUserId","candidateId","operationId","requestDigest","contentDigest",mode,profile,"profileFingerprint",status,report,"budgetUnits","createdAt","completedAt","expiresAt") SELECT $1,"workspaceId","actorUserId",id,$2,$3,"contentDigest",'static',$4::jsonb,$5,'completed','{"verdict":"clear","findings":[]}'::jsonb,0,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 minute' FROM "ReviewSkillImportCandidate" WHERE id=$6`,
        [
          scanId,
          command.operationId,
          `sha256:${createHash("sha256")
            .update(JSON.stringify([command.candidateId, command.mode]))
            .digest("hex")}`,
          JSON.stringify(profile),
          profile.fingerprint,
          candidateId,
        ],
      );
      await route.fallback();
    });
    await dialog
      .getByRole("button", { name: "Check skill", exact: true })
      .click();
    await expect(
      dialog.getByText("Check this skill again before adding it.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Add to library" }),
    ).toBeDisabled();
    const result = await page.evaluate(
      async ({ action, candidate, scan, workspace }) => {
        const response = await fetch(location.href, {
          method: "POST",
          headers: {
            "next-action": action,
            "content-type": "text/plain;charset=UTF-8",
          },
          body: JSON.stringify([
            {
              method: "importCandidate",
              input: {
                workspaceId: workspace,
                candidateId: candidate,
                scanId: scan,
                mode: "static",
                acknowledgeWarnings: true,
                acknowledgeOmissions: true,
              },
            },
          ]),
        });
        return response.text();
      },
      {
        action: actionId,
        candidate: candidateId,
        scan: scanId,
        workspace: workspaceId,
      },
    );
    expect(result).toContain('"code":"incomplete"');
    expect(
      await sql(`SELECT id FROM "ReviewSkill" WHERE "createOperationId"=$1`, [
        candidateId,
      ]),
    ).toHaveLength(0);
    await capture(dialog, "skills-catalog-expired-desktop.png");
  });

  test("Catalog late preview completion cannot reopen a closed view or steal focus", async ({
    page,
  }) => {
    const dialog = await openCatalog(page);
    await dialog
      .getByRole("searchbox", { name: "Search the catalog" })
      .fill("Warning review");
    let release!: () => void;
    let committed = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/dashboard?**", async (route) => {
      const request = route.request();
      if (
        !committed &&
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        (request.postData() ?? "").includes('"resolve"')
      ) {
        const response = await route.fetch();
        committed = true;
        await held;
        await route.fulfill({ response });
      } else await route.fallback();
    });
    await dialog
      .getByRole("button", { name: "Preview Warning review" })
      .click();
    await expect.poll(() => committed).toBe(true);
    await dialog.getByRole("button", { name: "Back to results" }).click();
    release();
    await expect(
      dialog.getByRole("searchbox", { name: "Search the catalog" }),
    ).toHaveValue("Warning review");
    await expect(
      dialog.getByRole("heading", { name: "warning-review", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => activeElementInside(dialog)).toBe(true);
  });
});
