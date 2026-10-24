import { readFile } from "node:fs/promises";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { FIXTURES } from "../contracts.ts";
import { SKILLS_SHARED_ID } from "../skills-fixtures.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
  expectNetworkViolations,
} from "./support.ts";

test.describe("Skills real Next and PostgreSQL", () => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_SKILLS !== "1",
    "Requires the explicit Skills fixture lane",
  );
  test.describe.configure({ mode: "serial" });
  async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ) {
    const client = new pg.Client({
      connectionString: process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL,
    });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  }
  async function openLibrary(page: Page, workspace = "rr-e2e-personal-viewer") {
    await page.goto(`/dashboard?section=skills&workspace=${workspace}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Skills", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-dashboard-layout-ready",
      "true",
    );
  }
  async function openRepoPage(
    page: Page,
    workspace = "rr-e2e-personal-viewer",
  ) {
    await page.goto(`/dashboard?section=repositories&workspace=${workspace}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("searchbox", { name: "Find repository", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-dashboard-layout-ready",
      "true",
    );
  }
  async function expectSavedFeedback(page: Page) {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const toast = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Skill saved" });
    await expect(toast.getByText("Skill saved", { exact: true })).toBeVisible();
    await expect(toast).toHaveCSS("opacity", "1");
  }
  async function managerSession(context: BrowserContext) {
    const header = process.env.ACCOUNTS_REFERENCE_E2E_MANAGER_COOKIE ?? "";
    const index = header.indexOf("=");
    if (index < 0) throw new Error("skills_manager_cookie_missing");
    await context.addCookies([
      {
        name: header.slice(0, index),
        value: header.slice(index + 1),
        url: process.env.ACCOUNTS_REFERENCE_E2E_BASE_URL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  test("Skills create, edit conflict, explicit save and nonauthor admin server denial", async ({
    page,
    context,
    browser,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await page.screenshot({
      path: test.info().outputPath("skills-library-mobile.png"),
    });
    const compact = page.getByRole("navigation", {
      name: "Dashboard sections",
    });
    const names = await compact.getByRole("link").allTextContents();
    expect(names.findIndex((name) => name.includes("Skills"))).toBe(
      names.findIndex((name) => name.includes("Memory")) - 1,
    );
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(390);
    const name = `Browser saved skill ${Date.now()}`;
    await editor.getByLabel("Name", { exact: false }).fill(name);
    await editor
      .getByLabel("Description", { exact: false })
      .fill("Created through the production server action");
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Check boundary conditions and preserve existing authorization.");
    page.once("dialog", (confirmation) => {
      void confirmation.dismiss();
    });
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    await editor.screenshot({
      path: test.info().outputPath("skills-editor-mobile.png"),
    });
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(
      page.getByRole("dialog", {
        name: "Assign skill to repositories",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    const created = await sql<{ id: string; headRevisionId: string }>(
      `SELECT s.id,s."headRevisionId" FROM "ReviewSkill" s JOIN "ReviewSkillRevision" r ON r.id=s."headRevisionId" WHERE r.name=$1`,
      [name],
    );
    expect(created).toHaveLength(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: test.info().outputPath("skills-library-desktop.png"),
    });
    await page.getByRole("searchbox", { name: "Search skills" }).fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Retained local conflict draft.");
    // A second real browser editor saves first, causing a genuine CAS conflict.
    const second = await context.newPage();
    await installLoopbackOnlyNetworkGuard(second, violations);
    await openLibrary(second);
    await second.getByRole("searchbox", { name: "Search skills" }).fill(name);
    await second.getByRole("button", { name, exact: true }).click();
    await second
      .getByRole("dialog")
      .getByLabel("Description", { exact: false })
      .fill("Concurrent saved description");
    let saveRequest: {
      url: string;
      headers: Record<string, string>;
      body: string;
    } | null = null;
    second.on("request", (request) => {
      if (
        !saveRequest &&
        request.method() === "POST" &&
        request.headers()["next-action"]
      )
        saveRequest = {
          url: request.url(),
          headers: request.headers(),
          body: request.postData() ?? "",
        };
    });
    await second
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      second.getByRole("dialog", { name: "Edit skill", exact: true }),
    ).not.toBeVisible();
    await expectSavedFeedback(second);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("draft is preserved");
    await expect(
      page
        .getByRole("dialog")
        .getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue("Retained local conflict draft.");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Keep draft and compare with current revision",
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Current saved revision" }),
    ).toContainText("Concurrent saved description");
    await page.getByRole("button", { name: "Keep reconciled draft" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit skill", exact: true }),
    ).not.toBeVisible();
    await expectSavedFeedback(page);
    await page.screenshot({
      path: test.info().outputPath("skills-edit-saved-desktop.png"),
    });
    const persisted = await sql<{ count: string }>(
      `SELECT count(*)::text FROM "ReviewSkillRevision" WHERE "skillId"=$1`,
      [created[0]!.id],
    );
    expect(persisted[0]!.count).toBe("3");
    // Replay the genuine action transport as a different current source admin.
    await sql(
      `INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role,"updatedAt") VALUES ('rr-e2e-other-source-admin',$1,$2,'admin',CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,
      [FIXTURES.workspaces.personalViewer, FIXTURES.users.other],
    );
    const other = await browser.newContext();
    await useOtherSession(other);
    expect(saveRequest).not.toBeNull();
    const captured = saveRequest as unknown as {
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    const headers = { ...captured.headers };
    delete headers.cookie;
    delete headers["content-length"];
    const denied = await other.request.post(captured.url, {
      headers,
      data: captured.body,
    });
    expect(await denied.text()).toContain("forbidden");
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillRevision" WHERE "skillId"=$1`,
          [created[0]!.id],
        )
      )[0]!.count,
    ).toBe("3");
    await other.close();
    await sql(
      `DELETE FROM "WorkspaceMember" WHERE id='rr-e2e-other-source-admin'`,
    );
    await second.close();
    await expectNetworkViolations(violations);
  });
  test("Skills imports and exports a maximum-size portable skill without changing Markdown", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    const name = `Portable browser skill ${Date.now()}`;
    const description = '"\t🙂'.repeat(341) + '"';
    const prefix =
      "    Keep this Markdown code block indented.\n\nCheck ownership boundaries.\n![untrusted](https://example.invalid/never-fetch.png)\n<script>throw new Error('never execute')</script>\n";
    const suffix = "  \n\n";
    const instructions =
      prefix +
      "x".repeat(32768 - Buffer.byteLength(prefix + suffix, "utf8")) +
      suffix;
    const portable = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${instructions}`;
    expect(Buffer.byteLength(instructions, "utf8")).toBe(32768);
    expect(Buffer.byteLength(portable, "utf8")).toBeGreaterThan(32768);
    await editor.getByLabel("Import SKILL.md", { exact: false }).setInputFiles({
      name: "SKILL.md",
      mimeType: "text/markdown",
      buffer: Buffer.alloc(64 * 1024 + 1, "x"),
    });
    await expect(
      editor.getByText(
        "SKILL.md must be 64 KiB or smaller; instructions are limited to 32 KiB.",
        { exact: true },
      ),
    ).toBeVisible();
    await editor.getByLabel("Import SKILL.md", { exact: false }).setInputFiles({
      name: "SKILL.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(portable),
    });
    await expect(editor.getByLabel("Name", { exact: false })).toHaveValue(name);
    await expect(
      editor.getByLabel("Description", { exact: false }),
    ).toHaveValue(description);
    await expect(
      editor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue(instructions);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("searchbox", { name: "Search skills" }).fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Export SKILL.md", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("SKILL.md");
    const path = await download.path();
    expect(path).toBeTruthy();
    const exported = await readFile(path!, "utf8");
    expect(exported).toBe(portable);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(path!);
    await expect(editor.getByLabel("Name", { exact: false })).toHaveValue(name);
    await expect(
      editor.getByLabel("Description", { exact: false }),
    ).toHaveValue(description);
    await expect(
      editor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue(instructions);
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill(instructions + "x");
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(path!);
    const copyName = `Imported copy ${Date.now()}`;
    await editor.getByLabel("Name", { exact: false }).fill(copyName);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).not.toBeVisible();
    const copied = await sql<{ instructions: string; description: string }>(
      `SELECT r.instructions, r.description FROM "ReviewSkill" s JOIN "ReviewSkillRevision" r ON r.id=s."headRevisionId" WHERE r.name=$1`,
      [copyName],
    );
    expect(copied).toEqual([{ instructions, description }]);
    await expectNetworkViolations(violations);
  });
  test("Skills all current 125 repositories, mixed counts, skill pages and delta remove", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await sql(
      `DELETE FROM "ReviewSkillBinding" WHERE "workspaceId"=$1 AND (("skillId"='rr-e2e-skill-001' AND "repositoryConnectionId"<>'rr-e2e-repo-rr-e2e-viewer-001') OR "skillId"='rr-e2e-skill-060')`,
      [FIXTURES.workspaces.personalViewer],
    );
    await openRepoPage(page);
    await page
      .getByRole("button", { name: "Select all 125 matching", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Find repository", exact: true })
      .fill("skills-project-125");
    await expect(
      page.getByText("125 selected · 124 outside current search", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Manage skills (125)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const row = dialog
      .getByRole("row")
      .filter({ hasText: "Fixture skill 001" });
    await expect(row.getByRole("cell").last()).toHaveText("1/125");
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole("button", { name: "Add selected skills", exact: true }),
    ).toBeVisible();
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    await row.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Load more skills", exact: true })
      .click();
    await dialog
      .getByRole("checkbox", {
        name: "Select skill Fixture skill 060",
        exact: true,
      })
      .check();
    const checkedSummary = dialog.getByText(
      "2 skills checked for this add operation. Changing search keeps checked skills.",
      { exact: true },
    );
    await expect(checkedSummary).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(checkedSummary).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-checked-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog
      .getByRole("searchbox", { name: "Search skills" })
      .fill("no matching skill");
    await expect(
      dialog.getByText(
        "2 skills checked for this add operation. Changing search keeps checked skills.",
        { exact: true },
      ),
    ).toBeVisible();
    await dialog.getByRole("searchbox", { name: "Search skills" }).fill("");
    await expect(row).toBeVisible();
    await dialog
      .getByRole("button", { name: "Add selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("249 added");
    await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-result-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "Add selected skills", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-result-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillBinding" WHERE "skillId" IN ('rr-e2e-skill-001','rr-e2e-skill-060')`,
        )
      )[0]!.count,
    ).toBe("250");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await dialog
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Fixture skill 060");
    await dialog
      .getByRole("checkbox", {
        name: "Select skill Fixture skill 060",
        exact: true,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Remove selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("125 removed");
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillBinding" WHERE "skillId"='rr-e2e-skill-001'`,
        )
      )[0]!.count,
    ).toBe("125");
    await expectNetworkViolations(violations);
  });
  test("Skills preserves all 1001 matching IDs and blocks an oversized atomic operation", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await sql(
      `INSERT INTO "RepositoryConnection" (id,"workspaceId",provider,"externalRepositoryId","installationId","githubRepositoryId",owner,name,"fullName","defaultBranch",visibility,selected,archived,"updatedAt") SELECT 'rr-e2e-repo-rr-e2e-viewer-'||lpad(i::text,4,'0'),$1,'github','rr-e2e-extra-'||i,'rr-e2e-install-personal-viewer',930000000000+i,'rr-e2e-viewer','skills-extra-'||i,'rr-e2e-viewer/skills-extra-'||i,'main','private',true,false,CURRENT_TIMESTAMP FROM generate_series(126,1001) i`,
      [FIXTURES.workspaces.personalViewer],
    );
    try {
      await openRepoPage(page);
      await page
        .getByRole("button", { name: "Select all 1001 matching", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Manage skills (1001)", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("alert")).toContainText(
        "All 1001 selected repositories are preserved",
      );
      await expect(
        dialog.getByRole("button", {
          name: "Add selected skills",
          exact: true,
        }),
      ).toBeDisabled();
      expect(
        (
          await sql<{ count: string }>(
            `SELECT count(*)::text FROM "ReviewSkillBinding" b JOIN "RepositoryConnection" r ON r.id=b."repositoryConnectionId" WHERE r."externalRepositoryId" LIKE 'rr-e2e-extra-%'`,
          )
        )[0]!.count,
      ).toBe("0");
    } finally {
      await sql(
        `DELETE FROM "RepositoryConnection" WHERE "externalRepositoryId" LIKE 'rr-e2e-extra-%' AND "workspaceId"=$1`,
        [FIXTURES.workspaces.personalViewer],
      );
    }
    await expectNetworkViolations(violations);
  });
  test("Skills lost Apply response stays unknown and retries the identical delta", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await sql(
      `DELETE FROM "ReviewSkillBinding" WHERE "repositoryConnectionId"='rr-e2e-repo-rr-e2e-viewer-125' AND "skillId"='rr-e2e-skill-003'`,
    );
    await openRepoPage(page);
    await page
      .getByRole("searchbox", { name: "Find repository", exact: true })
      .fill("skills-project-125");
    await page
      .getByRole("button", { name: "Select all 1 matching", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage skills (1)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Fixture skill 003");
    await dialog
      .getByRole("checkbox", {
        name: "Select skill Fixture skill 003",
        exact: true,
      })
      .check();
    let dropped = false;
    await page.route("**/dashboard?**", async (route) => {
      const request = route.request();
      if (
        !dropped &&
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        request.postData()?.includes("applyAssignments")
      ) {
        dropped = true;
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        await route.abort("failed");
      } else await route.fallback();
    });
    await dialog
      .getByRole("button", { name: "Add selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "result could not be confirmed",
    );
    await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", {
        name: "Retry exact operation",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-bulk-unknown-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(dropped).toBe(true);
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillBinding" WHERE "repositoryConnectionId"='rr-e2e-repo-rr-e2e-viewer-125' AND "skillId"='rr-e2e-skill-003'`,
        )
      )[0]!.count,
    ).toBe("1");
    await expect(
      dialog.getByRole("checkbox", {
        name: "Select skill Fixture skill 003",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Select skill Fixture skill 003",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Remove", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Retry exact operation", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "1 already in the requested state",
    );
    await expectNetworkViolations(violations);
  });
  test("Skills canonical linking has one original, local usage only and author edit route", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    // Keep the source library cached while editing its original from a link.
    await openLibrary(page);
    await page
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Canonical shared skill");
    await expect(
      page.getByRole("button", { name: "Canonical shared skill", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(page).toHaveURL(/workspace=rr-e2e-org-bravo/);
    await page
      .getByRole("button", { name: "Add from workspace", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Add from another workspace",
      exact: true,
    });
    await dialog
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Canonical shared skill");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Skill linked to this workspace.",
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const row = page
      .getByRole("row")
      .filter({ hasText: "Canonical shared skill" });
    await expect(row).toContainText("0 repositories");
    await expect(
      row.getByRole("link", { name: "Edit original" }),
    ).toHaveAttribute("href", /workspace=rr-e2e-ws-personal-viewer/);
    await row
      .getByRole("button", { name: "Canonical shared skill", exact: true })
      .click();
    const linkedEditor = page.getByRole("dialog", {
      name: "Edit skill",
      exact: true,
    });
    const sharedDescription = "The author updated this shared original.";
    const sharedInstructions =
      "Check the same ownership boundary in every linked workspace.";
    await linkedEditor
      .getByLabel("Description", { exact: false })
      .fill(sharedDescription);
    await linkedEditor
      .getByLabel("Markdown instructions", { exact: false })
      .fill(sharedInstructions);
    await linkedEditor
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(linkedEditor).not.toBeVisible();
    await expectSavedFeedback(page);
    await page.screenshot({
      path: test.info().outputPath("skills-linked-edit-saved-desktop.png"),
    });
    await expect(row).toContainText(sharedDescription);
    const savedHead = (
      await sql<{
        headRevisionId: string;
        revisionNumber: number;
        description: string;
        instructions: string;
      }>(
        `SELECT s."headRevisionId", r."revisionNumber", r.description, r.instructions
         FROM "ReviewSkill" s JOIN "ReviewSkillRevision" r ON r.id=s."headRevisionId"
         WHERE s.id=$1`,
        [SKILLS_SHARED_ID],
      )
    )[0]!;
    expect(savedHead).toMatchObject({
      revisionNumber: 2,
      description: sharedDescription,
      instructions: sharedInstructions,
    });
    await row.getByRole("link", { name: "Edit original", exact: true }).click();
    const sourceEditor = page.getByRole("dialog", {
      name: "Edit skill",
      exact: true,
    });
    await expect(
      sourceEditor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue(sharedInstructions);
    await sourceEditor
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Canonical shared skill");
    await expect(
      page.getByRole("row").filter({ hasText: "Canonical shared skill" }),
    ).toContainText(sharedDescription);
    expect(
      (
        await sql<{ headRevisionId: string }>(
          `SELECT "headRevisionId" FROM "ReviewSkill" WHERE id=$1`,
          [SKILLS_SHARED_ID],
        )
      )[0]!.headRevisionId,
    ).toBe(savedHead.headRevisionId);
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkill" WHERE id=$1`,
          [SKILLS_SHARED_ID],
        )
      )[0]!.count,
    ).toBe("1");
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillLink" WHERE "skillId"=$1`,
          [SKILLS_SHARED_ID],
        )
      )[0]!.count,
    ).toBe("2");
    await openLibrary(page);
    await page
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Fixture skill 002");
    await page
      .getByRole("row")
      .filter({ hasText: "Fixture skill 002" })
      .getByRole("button", { name: "Manage access", exact: true })
      .click();
    const access = page.getByRole("dialog", {
      name: "Manage skill access",
      exact: true,
    });
    await access
      .getByLabel("Destination workspace ID", { exact: true })
      .fill(FIXTURES.workspaces.personalOther);
    await access
      .getByRole("button", { name: "Grant access", exact: true })
      .click();
    await expect(
      access.getByText("Awaiting destination acceptance", { exact: false }),
    ).toBeVisible();
    const receiverContext = await page.context().browser()!.newContext();
    await useOtherSession(receiverContext);
    const receiver = await receiverContext.newPage();
    await installLoopbackOnlyNetworkGuard(receiver, violations);
    await openLibrary(receiver, "rr-e2e-personal-other");
    await receiver
      .getByRole("button", { name: "Add from workspace", exact: true })
      .click();
    const accept = receiver.getByRole("dialog", {
      name: "Add from another workspace",
      exact: true,
    });
    await accept
      .getByRole("searchbox", { name: "Search skills" })
      .fill("Fixture skill 002");
    await accept.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(accept.getByRole("status")).toContainText("Skill linked");
    await accept.getByRole("button", { name: "Close", exact: true }).click();
    const linked = receiver
      .getByRole("row")
      .filter({ hasText: "Fixture skill 002" });
    await expect(
      linked.getByRole("link", { name: "Edit original", exact: true }),
    ).toHaveCount(0);
    await linked
      .getByRole("button", { name: "Fixture skill 002", exact: true })
      .click();
    await expect(
      receiver
        .getByRole("dialog", { name: "View skill", exact: true })
        .getByLabel("Markdown instructions", { exact: false }),
    ).toHaveAttribute("readonly", "");
    await receiverContext.close();
    await expectNetworkViolations(violations);
  });
  test("Skills repository-only writer uses genuine App HTTP, hides body/foreign usage, removes revoked dependency", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await managerSession(context);
    await openLibrary(page, "rr-e2e-org-alpha");
    await expect(
      page.getByText(/Workspace membership is required/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create skill", exact: true }),
    ).toHaveCount(0);
    await openRepoPage(page, "rr-e2e-org-alpha");
    await expect(
      page.getByRole("checkbox", {
        name: "Select rr-e2e-org-alpha/skills-project-002",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("checkbox", {
        name: "Select rr-e2e-org-alpha/skills-project-001",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Manage skills (1)", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    const row = dialog
      .getByRole("row")
      .filter({ hasText: "Canonical shared skill" });
    await expect(row).toContainText("0/1");
    await expect(
      dialog.getByRole("button", { name: "Create skill", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Check fixture policy 061.", { exact: false }),
    ).toHaveCount(0);
    await row.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Add selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("1 added");
    // Revoke source grant and create a new immutable source head afterwards.
    await sql(
      `UPDATE "ReviewSkillGrant" SET "revokedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE "skillId"=$1 AND "destinationWorkspaceId"=$2`,
      [SKILLS_SHARED_ID, FIXTURES.workspaces.orgAlpha],
    );
    await sql(
      `INSERT INTO "ReviewSkillRevision" (id,"skillId","revisionNumber",name,description,instructions,"contentDigest")
       SELECT 'rr-e2e-private-post-revoke-revision',$1,MAX("revisionNumber")+1,'PRIVATE RENAMED AFTER REVOKE','PRIVATE DESCRIPTION','PRIVATE BODY',$2
       FROM "ReviewSkillRevision" WHERE "skillId"=$1`,
      [SKILLS_SHARED_ID, `sha256:${"f".repeat(64)}`],
    );
    await sql(
      `UPDATE "ReviewSkill" SET "headRevisionId"='rr-e2e-private-post-revoke-revision' WHERE id=$1`,
      [SKILLS_SHARED_ID],
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Manage skills (1)", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(
      dialog.getByText("PRIVATE RENAMED AFTER REVOKE", { exact: true }),
    ).toHaveCount(0);
    const unavailable = dialog
      .getByRole("row")
      .filter({ hasText: "Unavailable" });
    await expect(unavailable).toContainText("1/1");
    await unavailable.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Remove selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("1 removed");
    expect(
      (
        await sql<{ count: string }>(
          `SELECT count(*)::text FROM "ReviewSkillBinding" WHERE "skillId"=$1 AND "repositoryConnectionId"='rr-e2e-repo-rr-e2e-org-alpha-002'`,
          [SKILLS_SHARED_ID],
        )
      )[0]!.count,
    ).toBe("1");
    await expectNetworkViolations(violations);
  });
});
