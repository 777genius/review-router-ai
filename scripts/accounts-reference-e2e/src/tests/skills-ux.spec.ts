import { readFile } from "node:fs/promises";
import { test, expect, type Page, type Locator } from "@playwright/test";
import pg from "pg";
import { FIXTURES } from "../contracts.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
  expectNetworkViolations,
} from "./support.ts";

const workspaceId = FIXTURES.workspaces.personalViewer;
const workspaceQuery = "rr-e2e-personal-viewer";
const repositoryId = (suffix: string) => `rr-e2e-repo-rr-e2e-viewer-${suffix}`;

async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
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

async function openLibrary(page: Page) {
  await page.goto(`/dashboard?section=skills&workspace=${workspaceQuery}`, {
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

async function openOperation(page: Page, suffix: string, skill: string) {
  await page.goto(
    `/dashboard?section=repositories&workspace=${workspaceQuery}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page
    .getByRole("searchbox", { name: "Find repository", exact: true })
    .fill(`skills-project-${suffix}`);
  await page
    .getByRole("checkbox", {
      name: `Select rr-e2e-viewer/skills-project-${suffix}`,
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Manage skills (1)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("searchbox", { name: "Search skills", exact: true })
    .fill(skill);
  const row = dialog.getByRole("row").filter({ hasText: skill });
  await expect(row).toBeVisible();
  return { dialog, row };
}

async function ensurePaths(page: Page, suffix: string, skill: string) {
  const operation = await openOperation(page, suffix, skill);
  if ((await operation.row.getByText("Paths", { exact: true }).count()) === 0) {
    await operation.row.getByRole("checkbox").check();
    await operation.dialog
      .getByRole("button", { name: "Add selected skills", exact: true })
      .click();
    await expect(operation.dialog.getByRole("status")).toContainText("1 added");
  }
  await operation.row.getByText("Paths", { exact: true }).click();
  return operation;
}

async function binding(suffix: string, skillId: string) {
  return (
    await sql<{
      generation: string;
      version: number;
      includePaths: string[];
      excludePaths: string[];
    }>(
      `SELECT generation,version,"includePaths","excludePaths" FROM "ReviewSkillBinding" WHERE "repositoryConnectionId"=$1 AND "skillId"=$2`,
      [repositoryId(suffix), skillId],
    )
  )[0];
}

/** Hold a genuine committed response; never replace persistence with a mock. */
async function holdAction(page: Page, method: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered!: () => void;
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let captured = false;
  let committed = false;
  await page.route("**/dashboard?**", async (route) => {
    const request = route.request();
    if (
      !captured &&
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      request.postData()?.includes(`"${method}"`)
    ) {
      captured = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await released;
      await route.fulfill({ response });
      await (await request.response())?.finished();
      delivered();
    } else await route.fallback();
  });
  return { release, done, wait: () => expect.poll(() => committed).toBe(true) };
}

async function expectParentLocked(dialog: Locator) {
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("searchbox", { name: "Search skills", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Add selected skills", exact: true }),
  ).toBeDisabled();
}

test.describe("Skills real Next UX resilience", () => {
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_SKILLS !== "1",
    "Requires the explicit Skills fixture lane",
  );
  const violations = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page, context }) => {
    const observed: string[] = [];
    violations.set(page, observed);
    await installLoopbackOnlyNetworkGuard(page, observed);
    await useViewerSession(context);
  });
  test.afterEach(async ({ page }) => {
    await expectNetworkViolations(violations.get(page) ?? []);
  });

  test("Skills delayed Create and Edit lock fields, import and close until save completes", async ({
    page,
  }) => {
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    const name = `UX pending save ${Date.now()}`;
    await create.getByLabel("Name", { exact: false }).fill(name);
    await create
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Submitted create instructions.");
    const gate = await holdAction(page, "createSkill");
    try {
      await create.getByRole("button", { name: "Save", exact: true }).click();
      await gate.wait();
      for (const label of ["Name", "Description", "Markdown instructions"])
        await expect(create.getByLabel(label, { exact: false })).toBeDisabled();
      await expect(create.locator('input[type="file"]')).toBeDisabled();
      await expect(
        create.getByRole("button", { name: "Close", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(create).toBeVisible();
      await create.screenshot({
        path: test.info().outputPath("skills-pending-create.png"),
      });
    } finally {
      gate.release();
    }
    await expect(create).not.toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit skill", exact: true });
    await edit
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Submitted edit instructions.");
    const editGate = await holdAction(page, "saveSkill");
    try {
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await editGate.wait();
      await expect(
        edit.getByLabel("Markdown instructions", { exact: false }),
      ).toBeDisabled();
      await expect(
        edit.getByRole("button", { name: "Close", exact: true }),
      ).toBeDisabled();
    } finally {
      editGate.release();
    }
    await expect(edit).not.toBeVisible();
    const rows = await sql<{ instructions: string }>(
      `SELECT r.instructions FROM "ReviewSkill" s JOIN "ReviewSkillRevision" r ON r.id=s."headRevisionId" WHERE r.name=$1`,
      [name],
    );
    expect(rows).toEqual([{ instructions: "Submitted edit instructions." }]);
  });

  test("Skills lost committed Create retries the same immutable submission without a duplicate original", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    const name = `UX lost create ${Date.now()}`;
    await editor.getByLabel("Name", { exact: false }).fill(name);
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Recover this exact committed Create.");
    let dropped = false;
    const payloads: string[] = [];
    await page.route("**/dashboard?**", async (route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        request.postData()?.includes('"createSkill"')
      ) {
        payloads.push(request.postData()!);
        if (!dropped) {
          dropped = true;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          await route.abort("failed");
          return;
        }
      }
      await route.fallback();
    });
    const originals = () =>
      sql<{ id: string; createOperationId: string }>(
        `SELECT s.id,s."createOperationId" FROM "ReviewSkill" s JOIN "ReviewSkillRevision" r ON r.id=s."headRevisionId" WHERE r.name=$1`,
        [name],
      );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText(
      "result could not be confirmed",
    );
    await expect(editor.getByRole("status")).toContainText(
      "may already have been created",
    );
    expect(await originals()).toHaveLength(1);
    for (const label of ["Name", "Description", "Markdown instructions"])
      await expect(editor.getByLabel(label, { exact: false })).toBeDisabled();
    await expect(editor.locator('input[type="file"]')).toBeDisabled();
    for (const name of ["Export SKILL.md", "Retry save", "Close"]) {
      const button = editor.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await expect(button).toBeEnabled();
    }
    await editor.screenshot({
      path: test.info().outputPath("skills-create-unknown.png"),
    });
    await editor
      .getByRole("button", { name: "Retry save", exact: true })
      .click();
    await expect(editor).not.toBeVisible();
    const persisted = await originals();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.createOperationId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toBe(payloads[0]);
  });

  test("Skills Paths retain drafts across filtering and require explicit close or removal discard", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { dialog, row } = await ensurePaths(page, "123", "Fixture skill 055");
    for (const control of [
      row.getByRole("checkbox"),
      row.getByRole("textbox", { name: "Include paths", exact: true }),
      row.getByRole("button", { name: "Save paths", exact: true }),
      row.getByRole("cell").filter({ hasText: /Assigned\s*1\/1/u }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      const bounds = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await row.screenshot({
      path: test.info().outputPath("skills-mobile-path-controls.png"),
    });
    await row
      .getByRole("textbox", { name: "Include paths", exact: true })
      .fill("retained-draft/**");
    await dialog
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 056");
    await expect(
      dialog.getByRole("row").filter({ hasText: "Fixture skill 055" }),
    ).toHaveCount(0);
    await dialog
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 055");
    await row.getByText("Paths", { exact: true }).click();
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("retained-draft/**");
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Search keeps these drafts" }),
    ).toBeVisible();
    for (const action of ["Close", "Escape"] as const) {
      const prompt = page.waitForEvent("dialog");
      const closing =
        action === "Close"
          ? dialog.getByRole("button", { name: "Close", exact: true }).click()
          : page.keyboard.press("Escape");
      const confirmation = await prompt;
      expect(confirmation.message()).toBe(
        "Discard your unsaved skill path changes?",
      );
      await confirmation.dismiss();
      await closing;
      await expect(dialog).toBeVisible();
    }
    page.once("dialog", (value) => {
      void value.accept();
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await ensurePaths(page, "123", "Fixture skill 055");
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("**");
    await row
      .getByRole("textbox", { name: "Include paths", exact: true })
      .fill("retained-draft/**");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await row.getByRole("checkbox").check();
    const canceledPrompt = page.waitForEvent("dialog");
    const canceledRemove = dialog
      .getByRole("button", { name: "Remove selected skills", exact: true })
      .click();
    const confirmation = await canceledPrompt;
    expect(confirmation.message()).toContain(
      "discard their unsaved path changes",
    );
    await confirmation.dismiss();
    await canceledRemove;
    expect((await binding("123", "rr-e2e-skill-055"))!.includePaths).toEqual([
      "**",
    ]);
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("retained-draft/**");
    page.once("dialog", (value) => {
      void value.accept();
    });
    await dialog
      .getByRole("button", { name: "Remove selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("1 removed");
    expect(await binding("123", "rr-e2e-skill-055")).toBeUndefined();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("Skills nested Paths and Git source saves lock the parent until persistence is acknowledged", async ({
    page,
  }) => {
    const { dialog, row } = await ensurePaths(page, "124", "Fixture skill 056");
    await row.getByRole("checkbox").check();
    await row
      .getByRole("textbox", { name: "Include paths", exact: true })
      .fill("confirmed-save/**");
    const gate = await holdAction(page, "updateBindingScope");
    try {
      await row
        .getByRole("button", { name: "Save paths", exact: true })
        .click();
      await gate.wait();
      await expectParentLocked(dialog);
      await expect(
        row.getByRole("button", { name: "Saving paths…", exact: true }),
      ).toBeDisabled();
    } finally {
      gate.release();
    }
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeEnabled();
    expect((await binding("124", "rr-e2e-skill-056"))!.includePaths).toEqual([
      "confirmed-save/**",
    ]);
    await dialog
      .getByText("Repository paths and Git skills", { exact: true })
      .click();
    const git = dialog.getByRole("checkbox", {
      name: ".reviewrouter/skills",
      exact: true,
    });
    await expect(git).toBeVisible();
    if (await git.isChecked()) {
      await git.click();
      await expect(git).not.toBeChecked();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeEnabled();
    }
    const sourceGate = await holdAction(page, "setRepositorySources");
    try {
      // This setting renders confirmed persistence rather than an optimistic
      // toggle, so the held response intentionally delays its checked state.
      await git.click();
      await sourceGate.wait();
      await expectParentLocked(dialog);
      await expect(
        dialog
          .getByRole("status")
          .filter({ hasText: "Saving repository sources" }),
      ).toBeVisible();
    } finally {
      sourceGate.release();
    }
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeEnabled();
    await expect(git).toBeChecked();
    const roots = await sql<{ roots: string[] }>(
      `SELECT roots FROM "ReviewSkillRepositorySource" WHERE "repositoryConnectionId"=$1`,
      [repositoryId("124")],
    );
    expect(roots[0]!.roots).toContain(".reviewrouter/skills");
  });

  test("Skills generation rejects an old Paths editor after remove and re-add at version one", async ({
    page,
    context,
  }) => {
    const first = await ensurePaths(page, "122", "Fixture skill 057");
    const original = (await binding("122", "rr-e2e-skill-057"))!;
    await first.row
      .getByRole("textbox", { name: "Include paths", exact: true })
      .fill("stale-incarnation/**");
    const second = await context.newPage();
    const network: string[] = [];
    await installLoopbackOnlyNetworkGuard(second, network);
    try {
      const current = await openOperation(second, "122", "Fixture skill 057");
      await current.dialog
        .getByRole("button", { name: "Remove", exact: true })
        .click();
      await current.row.getByRole("checkbox").check();
      await current.dialog
        .getByRole("button", { name: "Remove selected skills", exact: true })
        .click();
      await expect(current.dialog.getByRole("status")).toContainText(
        "1 removed",
      );
      await current.dialog
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await current.row.getByRole("checkbox").check();
      await current.dialog
        .getByRole("button", { name: "Add selected skills", exact: true })
        .click();
      await expect(current.dialog.getByRole("status")).toContainText("1 added");
      const recreated = (await binding("122", "rr-e2e-skill-057"))!;
      expect(recreated.version).toBe(original.version);
      expect(recreated.generation).not.toBe(original.generation);
      await first.row
        .getByRole("button", { name: "Save paths", exact: true })
        .click();
      await expect(first.row.getByRole("alert")).toContainText(
        "saved version changed",
      );
      await expect(
        first.row.getByRole("textbox", { name: "Include paths", exact: true }),
      ).toHaveValue("stale-incarnation/**");
      expect(await binding("122", "rr-e2e-skill-057")).toEqual(recreated);
      await first.row
        .getByRole("button", {
          name: "Keep draft and compare current paths",
          exact: true,
        })
        .click();
      await first.row
        .getByRole("button", { name: "Use current saved paths", exact: true })
        .click();
      await expect(
        first.row.getByRole("textbox", { name: "Include paths", exact: true }),
      ).toHaveValue("**");
      let unexpectedPrompt = false;
      page.once("dialog", (value) => {
        unexpectedPrompt = true;
        void value.dismiss();
      });
      await first.dialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(first.dialog).not.toBeVisible();
      expect(unexpectedPrompt).toBe(false);
      await expectNetworkViolations(network);
    } finally {
      await second.close();
    }
  });

  test("Skills late loads cannot replace a Create draft or a newer selected skill", async ({
    page,
  }) => {
    await openLibrary(page);
    const firstGate = await holdAction(page, "loadSkill");
    try {
      await page
        .getByRole("button", { name: "Fixture skill 002", exact: true })
        .click();
      await firstGate.wait();
      await expect(page.getByRole("status")).toContainText("Opening skill");
      await page
        .getByRole("button", { name: "Create skill", exact: true })
        .click();
      const create = page.getByRole("dialog", {
        name: "Create skill",
        exact: true,
      });
      await create
        .getByLabel("Name", { exact: false })
        .fill("A local draft after an earlier load");
      await create
        .getByLabel("Markdown instructions", { exact: false })
        .fill("Keep this draft.");
      firstGate.release();
      await firstGate.done;
      // Let React consume the delivered action before checking that its older
      // editor intent did not replace the newer local Create draft.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(create.getByLabel("Name", { exact: false })).toHaveValue(
        "A local draft after an earlier load",
      );
      await expect(
        page.getByRole("dialog", { name: "Edit skill", exact: true }),
      ).not.toBeVisible();
      page.once("dialog", (value) => {
        void value.accept();
      });
      await create.getByRole("button", { name: "Close", exact: true }).click();
    } finally {
      firstGate.release();
    }
    const secondGate = await holdAction(page, "loadSkill");
    try {
      await page
        .getByRole("button", { name: "Fixture skill 003", exact: true })
        .click();
      await secondGate.wait();
      await page
        .getByRole("button", { name: "Fixture skill 004", exact: true })
        .click();
    } finally {
      secondGate.release();
    }
    await expect(
      page.getByRole("dialog").getByLabel("Name", { exact: false }),
    ).toHaveValue("Fixture skill 004");
  });

  test("Skills mobile actions fit without horizontal scrolling and member usage stays private", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    const row = page.getByRole("row").filter({
      has: page.getByRole("button", {
        name: "Fixture skill 001",
        exact: true,
      }),
    });
    for (const name of [
      "Edit",
      "Repositories",
      "Manage access",
      "Delete original",
    ]) {
      const button = row.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    const table = page.getByRole("table", { name: "Workspace review skills" });
    expect(
      await table.evaluate((node) => ({
        width: node.getBoundingClientRect().width,
        scroll: node.parentElement!.scrollLeft,
      })),
    ).toMatchObject({ scroll: 0 });
    await row.screenshot({
      path: test.info().outputPath("skills-mobile-visible-actions.png"),
    });
    await sql(
      `INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role,"updatedAt") VALUES ('rr-e2e-skills-usage-member',$1,$2,'member',CURRENT_TIMESTAMP)`,
      [workspaceId, FIXTURES.users.other],
    );
    const member = await browser.newContext();
    try {
      await useOtherSession(member);
      const memberPage = await member.newPage();
      const network: string[] = [];
      await installLoopbackOnlyNetworkGuard(memberPage, network);
      await openLibrary(memberPage);
      const memberRow = memberPage.getByRole("row").filter({
        has: memberPage.getByRole("button", {
          name: "Fixture skill 001",
          exact: true,
        }),
      });
      await expect(memberRow).toContainText(
        "Workspace admins can see repository usage.",
      );
      await expect(memberRow).not.toContainText("0 repositories");
      await expect(
        memberRow.getByText("Show repositories", { exact: true }),
      ).toHaveCount(0);
      await expect(
        memberRow.getByRole("button", { name: "Manage access", exact: true }),
      ).toHaveCount(0);
      await expectNetworkViolations(network);
    } finally {
      await member.close();
      await sql(
        `DELETE FROM "WorkspaceMember" WHERE id='rr-e2e-skills-usage-member'`,
      );
    }
  });

  test("Skills export contains the visible unsaved Markdown draft", async ({
    page,
  }) => {
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Fixture skill 005", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Edit skill",
      exact: true,
    });
    const markdown =
      "\n## Unsaved draft\n\n  Preserve leading and trailing whitespace.  \n\n";
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill(markdown);
    const downloadEvent = page.waitForEvent("download");
    await editor
      .getByRole("button", { name: "Export SKILL.md", exact: true })
      .click();
    const download = await downloadEvent;
    const path = test.info().outputPath("unsaved-SKILL.md");
    await download.saveAs(path);
    const exported = await readFile(path, "utf8");
    expect(exported.replace(/^---\n[\s\S]*?\n---\n/u, "")).toBe(markdown);
    const persisted = await sql<{ instructions: string }>(
      `SELECT instructions FROM "ReviewSkillRevision" WHERE "skillId"='rr-e2e-skill-005' ORDER BY "revisionNumber" DESC LIMIT 1`,
    );
    expect(persisted[0]!.instructions).not.toBe(markdown);
  });
});
