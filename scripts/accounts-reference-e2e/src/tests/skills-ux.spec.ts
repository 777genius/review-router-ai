import { readFile } from "node:fs/promises";
import {
  test,
  expect as baseExpect,
  type Page,
  type Locator,
} from "@playwright/test";
import pg from "pg";
import { FIXTURES } from "../contracts.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
  expectNetworkViolations,
} from "./support.ts";

// Skills reads and writes share Next's serialized Server Action queue.
// Give genuine responses the same budget as navigation.
const expect = baseExpect.configure({ timeout: 30_000 });
test.use({ actionTimeout: 30_000 });

const workspaceId = FIXTURES.workspaces.personalViewer;
const workspaceQuery = "rr-e2e-personal-viewer";
const repositoryId = (suffix: string) => `rr-e2e-repo-rr-e2e-viewer-${suffix}`;

async function expectDashboardReady(page: Page) {
  // DOMContentLoaded can precede the streamed dashboard bundle on a new page.
  await expect(page.locator("html")).toHaveAttribute(
    "data-dashboard-layout-ready",
    "true",
  );
}

async function expectDialogCloseControls(dialog: Locator, title: string) {
  await expect(dialog).toHaveAccessibleName(title);
  for (const name of [`Close ${title}`, "Close"]) {
    const control = dialog.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport({ ratio: 1 });
  }
}

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
  await expectDashboardReady(page);
}

async function openOperation(page: Page, suffix: string, skill: string) {
  await page.goto(
    `/dashboard?section=repositories&workspace=${workspaceQuery}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await expectDashboardReady(page);
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
  await expect(
    dialog.getByRole("heading", { name: "Assigned skills", exact: true }),
  ).toBeVisible();
  // The first assigned read shares Next's action queue with Add/search.
  // Let it settle before measuring the searched-row assertion.
  await expect(
    dialog.getByRole("status").filter({
      hasText: /^Loading (?:assigned|available) skills…$/u,
    }),
  ).toBeHidden();
  const suffixMatch = /Fixture skill (\d+)$/u.exec(skill);
  if (!suffixMatch) throw new Error("scope_test_requires_named_fixture_skill");
  if (!(await binding(suffix, `rr-e2e-skill-${suffixMatch[1]}`)))
    await dialog
      .getByRole("button", { name: "Add skills", exact: true })
      .click();
  await dialog
    .getByRole("searchbox", { name: "Search skills", exact: true })
    .fill(skill);
  const row = dialog.getByRole("row").filter({ hasText: skill });
  await expect(row).toBeVisible();
  return { dialog, row };
}

async function ensurePaths(page: Page, suffix: string, skill: string) {
  const operation = await openOperation(page, suffix, skill);
  if (
    (await operation.row.getByText("File scope", { exact: true }).count()) === 0
  ) {
    await operation.row.getByRole("checkbox").check();
    await operation.dialog
      .getByRole("button", { name: "Add 1 skill", exact: true })
      .click();
    await expect(operation.dialog.getByRole("status")).toContainText("1 added");
    await expect(
      operation.dialog.getByRole("heading", {
        name: "Assigned skills",
        exact: true,
      }),
    ).toBeVisible();
    // The mutation receipt can arrive before the streamed Next action and
    // invalidated choice queries finish. Wait for the real readback boundary.
    await expect(
      operation.dialog.getByRole("searchbox", {
        name: "Search skills",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 60_000 });
    await expect(
      operation.row.getByText("File scope", { exact: true }),
    ).toBeVisible();
  }
  await operation.row.getByText("File scope", { exact: true }).click();
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
async function holdAction(
  page: Page,
  method: string,
  matchesInput?: (input: string) => boolean,
) {
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
    const input = request.postData() ?? "";
    if (
      !captured &&
      request.method() === "POST" &&
      request.headers()["next-action"] &&
      input.includes(`"${method}"`) &&
      (!matchesInput || matchesInput(input))
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
  return {
    release,
    done,
    waitForRequest: (timeout = 30_000) =>
      expect.poll(() => captured, { timeout }).toBe(true),
    wait: (timeout = 30_000) =>
      expect.poll(() => committed, { timeout }).toBe(true),
  };
}

async function expectParentLocked(dialog: Locator) {
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("searchbox", { name: "Search skills", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: /^Remove skill /u }).first(),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Add skills", exact: true }),
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

  test("Skills acknowledged Add shows refreshing until its genuine assigned readback arrives", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await binding("121", "rr-e2e-skill-053")).toBeUndefined();
    const { dialog, row } = await openOperation(
      page,
      "121",
      "Fixture skill 053",
    );
    const readback = await holdAction(page, "listAssignmentChoices", (input) =>
      input.includes('"assignedOnly":true'),
    );
    try {
      await row.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "Add 1 skill", exact: true })
        .click();
      await readback.wait();
      expect(await binding("121", "rr-e2e-skill-053")).toBeTruthy();
      await expect(
        dialog.getByRole("heading", { name: "Assigned skills", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("Refreshing skills…", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText(/^No matching assigned skills\./u),
      ).toHaveCount(0);
      await dialog.screenshot({
        path: test.info().outputPath("skills-assigned-refreshing-mobile.png"),
      });
    } finally {
      readback.release();
    }
    await readback.done;
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeEnabled();
    await expect(row.getByText("File scope", { exact: true })).toBeVisible();
    await row.getByText("File scope", { exact: true }).click();
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("**");
  });

  test("Skills Paths retain drafts across filtering and require explicit close or removal discard", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { dialog, row } = await ensurePaths(page, "123", "Fixture skill 055");
    for (const control of [
      row.getByRole("button", {
        name: "Remove skill Fixture skill 055",
        exact: true,
      }),
      row.getByRole("textbox", { name: "Include paths", exact: true }),
      row.getByRole("button", { name: "Save paths", exact: true }),
      row.getByText(/^Applies to:/u),
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
    await row.getByText("File scope", { exact: true }).click();
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("retained-draft/**");
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Search keeps these drafts" }),
    ).toBeVisible();
    let navigationPrompt = false;
    const dismissNavigationPrompt = (
      value: import("@playwright/test").Dialog,
    ) => {
      navigationPrompt = true;
      void value.dismiss();
    };
    page.on("dialog", dismissNavigationPrompt);
    await dialog
      .getByRole("button", { name: "Add skills", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Back to assigned skills", exact: true })
      .click();
    await row.getByText("File scope", { exact: true }).click();
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("retained-draft/**");
    await dialog
      .getByRole("button", { name: "Add skills", exact: true })
      .click();
    await dialog
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 054");
    await dialog
      .getByRole("row")
      .filter({ hasText: "Fixture skill 054" })
      .getByRole("checkbox")
      .check();
    await dialog
      .getByRole("button", { name: "Add 1 skill", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Assigned skills", exact: true }),
    ).toBeVisible();
    await row.getByText("File scope", { exact: true }).click();
    await expect(
      row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("retained-draft/**");
    page.off("dialog", dismissNavigationPrompt);
    expect(navigationPrompt).toBe(false);
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
    const canceledPrompt = page.waitForEvent("dialog");
    const canceledRemove = row
      .getByRole("button", {
        name: "Remove skill Fixture skill 055",
        exact: true,
      })
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
    const readback = await holdAction(
      page,
      "listAssignmentChoices",
      (input) =>
        input.includes('"assignedOnly":true') &&
        input.includes(repositoryId("123")),
    );
    try {
      page.once("dialog", (value) => {
        void value.accept();
      });
      await row
        .getByRole("button", {
          name: "Remove skill Fixture skill 055",
          exact: true,
        })
        .click();
      await expect(dialog.getByRole("status")).toContainText("1 removed");
      expect(await binding("123", "rr-e2e-skill-055")).toBeUndefined();
      await readback.waitForRequest();
      for (const name of ["Close", "Close Assigned skills"]) {
        await expect(
          dialog.getByRole("button", { name, exact: true }),
        ).toBeEnabled();
      }
      await expect(
        row.getByRole("button", {
          name: "Remove skill Fixture skill 055",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Add skills", exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("searchbox", { name: "Search skills", exact: true }),
      ).toBeDisabled();
      await dialog.screenshot({
        path: test
          .info()
          .outputPath("skills-acknowledged-removal-refreshing-mobile.png"),
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      readback.release();
    }
    await readback.done;
  });

  test("Skills nested Paths and Git source saves lock the parent until persistence is acknowledged", async ({
    page,
  }) => {
    const { dialog, row } = await ensurePaths(page, "124", "Fixture skill 056");
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
    await expect(
      row.getByText("File scope saved.", { exact: true }),
    ).toBeVisible();
    expect((await binding("124", "rr-e2e-skill-056"))!.includePaths).toEqual([
      "confirmed-save/**",
    ]);
    await dialog
      .getByText("Skills from this repository", { exact: true })
      .click();
    const git = dialog.getByRole("checkbox", {
      name: ".reviewrouter/skills",
      exact: true,
    });
    await expect(git).toBeVisible();
    await expect(
      dialog.getByText(/Workflow support is not confirmed\./u),
    ).toBeVisible();
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
    await expect(
      dialog.getByText("Repository skill sources saved.", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(/Workflow support is not confirmed\./u),
    ).toBeVisible();
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
    await first.dialog
      .getByRole("button", { name: "Add skills", exact: true })
      .click();
    await first.dialog
      .getByRole("button", { name: "Back to assigned skills", exact: true })
      .click();
    await first.row.getByText("File scope", { exact: true }).click();
    await expect(
      first.row.getByRole("textbox", { name: "Include paths", exact: true }),
    ).toHaveValue("stale-incarnation/**");
    const second = await context.newPage();
    const network: string[] = [];
    await installLoopbackOnlyNetworkGuard(second, network);
    try {
      const current = await openOperation(second, "122", "Fixture skill 057");
      await current.row
        .getByRole("button", {
          name: "Remove skill Fixture skill 057",
          exact: true,
        })
        .click();
      await expect(current.dialog.getByRole("status")).toContainText(
        "1 removed",
      );
      await current.dialog
        .getByRole("button", { name: "Add skills", exact: true })
        .click();
      await current.dialog
        .getByRole("searchbox", { name: "Search skills", exact: true })
        .fill("Fixture skill 057");
      await current.row.getByRole("checkbox").check();
      await current.dialog
        .getByRole("button", { name: "Add 1 skill", exact: true })
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
      "Assign to repositories",
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

  test("Skills readiness explains mixed saved setups and Assigned includes skills beyond the library first page", async ({
    page,
  }) => {
    const skillId = "rr-e2e-skill-060";
    const suffixes = ["001", "002", "003"];
    await sql(
      `DELETE FROM "ReviewSkillBinding" WHERE "skillId"=$1 AND "repositoryConnectionId"=ANY($2::text[])`,
      [skillId, suffixes.map(repositoryId)],
    );
    await page.goto(
      `/dashboard?section=repositories&workspace=${workspaceQuery}`,
      { waitUntil: "domcontentloaded" },
    );
    await expectDashboardReady(page);
    await page
      .getByRole("searchbox", { name: "Find repository", exact: true })
      .fill("skills-project-00");
    for (const suffix of suffixes)
      await page
        .getByRole("checkbox", {
          name: `Select rr-e2e-viewer/skills-project-${suffix}`,
          exact: true,
        })
        .check();
    await page
      .getByRole("button", { name: "Manage skills (3)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(/1\/3 configured runtimes support Skills/u),
    ).toContainText("1 needs setup changes · 1 unconfirmed");
    await dialog
      .getByText("Show repositories needing attention", { exact: true })
      .click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: "skills-project-002" }),
    ).toContainText("configured review engine does not support Skills");
    await expect(
      dialog.getByRole("listitem").filter({ hasText: "skills-project-003" }),
    ).toContainText("Workflow support is not confirmed");
    await dialog
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 060");
    await dialog
      .getByRole("checkbox", {
        name: "Select skill Fixture skill 060",
        exact: true,
      })
      .check();
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-readiness-mixed-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectDialogCloseControls(dialog, "Add skills to repositories");
    await page.screenshot({
      path: test.info().outputPath("skills-readiness-mixed-mobile.png"),
    });
    await dialog
      .getByRole("button", { name: "Add selected skills", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("3 added");
    for (const suffix of suffixes)
      expect(await binding(suffix, skillId)).toBeTruthy();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    for (const suffix of ["002", "003"])
      await page
        .getByRole("checkbox", {
          name: `Select rr-e2e-viewer/skills-project-${suffix}`,
          exact: true,
        })
        .uncheck();
    await page
      .getByRole("button", { name: "Manage skills (1)", exact: true })
      .click();
    await expect(dialog).toHaveAccessibleName("Assigned skills");
    await expect(
      dialog.getByRole("searchbox", { name: "Search skills", exact: true }),
    ).toHaveValue("");
    await expect(
      dialog.getByRole("row").filter({ hasText: "Fixture skill 060" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Load more skills", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText(/Configured runtime supports Skills\./u),
    ).toBeVisible();
    await dialog
      .getByText("Skills from this repository", { exact: true })
      .click();
    await expect(
      dialog.getByText("Changes save immediately.", { exact: true }),
    ).toBeVisible();
    await dialog.screenshot({
      path: test.info().outputPath("skills-assigned-sources-mobile.png"),
    });
    await dialog
      .getByText(/Configured runtime supports Skills\./u)
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Add skills", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expectDialogCloseControls(dialog, "Assigned skills");
    await page.screenshot({
      path: test.info().outputPath("skills-assigned-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.screenshot({
      path: test.info().outputPath("skills-assigned-desktop.png"),
    });
  });

  test("Skills known-skill assignment stays in one picker and retries the exact committed delta", async ({
    page,
  }) => {
    const skillId = "rr-e2e-skill-058";
    const ids = [repositoryId("010"), repositoryId("060")];
    await sql(
      `DELETE FROM "ReviewSkillBinding" WHERE "skillId"=$1 AND "repositoryConnectionId"=ANY($2::text[])`,
      [skillId, ids],
    );
    await sql(
      `INSERT INTO "ReviewSkillBinding" ("workspaceId","repositoryConnectionId","skillId","includePaths","excludePaths") VALUES ($1,$2,$3,'["existing/**"]','[]')`,
      [workspaceId, ids[0], skillId],
    );
    await openLibrary(page);
    await page
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 058");
    await page
      .getByRole("row")
      .filter({ hasText: "Fixture skill 058" })
      .getByRole("button", { name: "Assign to repositories", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Assign skill to repositories");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      dialog.getByRole("searchbox", { name: "Search skills", exact: true }),
    ).toHaveCount(0);
    const target = (suffix: string) =>
      dialog.getByRole("checkbox", {
        name: `Select rr-e2e-viewer/skills-project-${suffix}`,
        exact: true,
      });
    await target("010").check();
    await dialog
      .getByRole("button", { name: "Load more repositories", exact: true })
      .click();
    await target("060").check();
    await expect(dialog.getByText(/2 repositories checked\./u)).toBeVisible();
    await dialog
      .getByText("File scope for new assignments", { exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Include paths", exact: true })
      .fill("src/**");
    const payloads: string[] = [];
    let dropped = false;
    await page.route("**/dashboard?**", async (route) => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        request.postData()?.includes('"applyAssignments"')
      ) {
        payloads.push(request.postData()!);
        if (!dropped) {
          dropped = true;
          const committed = await route.fetch();
          expect(committed.ok()).toBe(true);
          await route.abort("failed");
          return;
        }
      }
      await route.fallback();
    });
    await dialog
      .getByRole("button", { name: "Assign to 2 repositories", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "result could not be confirmed",
    );
    expect(dropped).toBe(true);
    expect((await binding("010", skillId))!.includePaths).toEqual([
      "existing/**",
    ]);
    expect((await binding("060", skillId))!.includePaths).toEqual(["src/**"]);
    for (const control of [
      target("010"),
      target("060"),
      dialog.getByRole("searchbox", {
        name: "Search repositories",
        exact: true,
      }),
      dialog.getByRole("button", { name: "Remove", exact: true }),
      dialog.getByRole("textbox", { name: "Include paths", exact: true }),
    ])
      await expect(control).toBeDisabled();
    await dialog
      .getByRole("button", {
        name: "Refresh repository assignments",
        exact: true,
      })
      .click();
    await expect(target("010")).toBeChecked();
    await expect(target("060")).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole("button", {
        name: "Retry exact operation",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    await dialog.screenshot({
      path: test
        .info()
        .outputPath("skills-direct-assignment-unknown-mobile.png"),
    });
    await dialog
      .getByRole("button", { name: "Retry exact operation", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "2 already in the requested state",
    );
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toBe(payloads[0]);
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await dialog
      .getByRole("searchbox", { name: "Search repositories", exact: true })
      .fill("skills-project-010");
    await target("010").check();
    await dialog
      .getByRole("searchbox", { name: "Search repositories", exact: true })
      .fill("skills-project-060");
    await target("060").check();
    await dialog
      .getByRole("button", { name: "Remove from 2 repositories", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("2 removed");
    expect(await binding("010", skillId)).toBeUndefined();
    expect(await binding("060", skillId)).toBeUndefined();
  });

  test("Skills shared-link completion hands off to assignment without stacked dialogs", async ({
    page,
  }) => {
    const skillId = "rr-e2e-skill-059";
    await sql(
      `DELETE FROM "ReviewSkillBinding" WHERE "workspaceId"=$1 AND "skillId"=$2`,
      [FIXTURES.workspaces.orgAlpha, skillId],
    );
    await sql(
      `DELETE FROM "ReviewSkillLink" WHERE "workspaceId"=$1 AND "skillId"=$2`,
      [FIXTURES.workspaces.orgAlpha, skillId],
    );
    await sql(
      `DELETE FROM "ReviewSkillGrant" WHERE "destinationWorkspaceId"=$1 AND "skillId"=$2`,
      [FIXTURES.workspaces.orgAlpha, skillId],
    );
    const original = await sql(
      `SELECT "headRevisionId" FROM "ReviewSkill" WHERE id=$1`,
      [skillId],
    );
    await page.goto("/dashboard?section=skills&workspace=rr-e2e-org-alpha", {
      waitUntil: "domcontentloaded",
    });
    await expectDashboardReady(page);
    await page
      .getByRole("button", { name: "Add from workspace", exact: true })
      .click();
    const shared = page.getByRole("dialog", {
      name: "Add from another workspace",
      exact: true,
    });
    await shared
      .getByRole("searchbox", { name: "Search skills", exact: true })
      .fill("Fixture skill 059");
    await shared.getByRole("button", { name: "Add", exact: true }).click();
    await expect(shared.getByRole("status")).toContainText(
      "added to this library. Choose repositories to use it.",
    );
    await expect(
      shared.getByRole("button", { name: "Added", exact: true }),
    ).toBeDisabled();
    expect(
      await sql(
        `SELECT "skillId" FROM "ReviewSkillBinding" WHERE "workspaceId"=$1 AND "skillId"=$2`,
        [FIXTURES.workspaces.orgAlpha, skillId],
      ),
    ).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await shared.screenshot({
      path: test
        .info()
        .outputPath("skills-shared-assignment-handoff-mobile.png"),
    });
    await shared
      .getByRole("button", { name: "Assign to repositories", exact: true })
      .click();
    const targets = page.getByRole("dialog", {
      name: "Assign skill to repositories",
      exact: true,
    });
    await expect(shared).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      targets.getByRole("searchbox", {
        name: "Search repositories",
        exact: true,
      }),
    ).toBeFocused();
    await targets
      .getByRole("checkbox", {
        name: "Select rr-e2e-org-alpha/skills-project-001",
        exact: true,
      })
      .check();
    await targets
      .getByRole("button", { name: "Assign to 1 repository", exact: true })
      .click();
    await expect(targets.getByRole("status")).toContainText("1 added");
    expect(
      await sql(
        `SELECT "repositoryConnectionId" FROM "ReviewSkillBinding" WHERE "workspaceId"=$1 AND "skillId"=$2`,
        [FIXTURES.workspaces.orgAlpha, skillId],
      ),
    ).toEqual([{ repositoryConnectionId: "rr-e2e-repo-rr-e2e-org-alpha-001" }]);
    expect(
      await sql(`SELECT "headRevisionId" FROM "ReviewSkill" WHERE id=$1`, [
        skillId,
      ]),
    ).toEqual(original);
  });

  test("Skills import explicitly omits metadata and preserves a draft until confirmed", async ({
    page,
  }) => {
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    await editor
      .getByLabel("Name", { exact: false })
      .fill("Keep my original draft");
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Do not discard these instructions.");
    const body = "\n## Проверка\n\nKeep this exact body.  \n";
    const imported = {
      name: "SKILL.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        `---\nname: "Проверка 🙂"\ndescription: ""\nlicense: MIT\ncompatibility: ReviewRouter\nmetadata:\n  author: fixture\n---\n${body}`,
      ),
    };
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(imported);
    await expect(
      editor.getByRole("region", { name: "Review import" }),
    ).toContainText("license, compatibility, metadata");
    await expect(editor.getByLabel("Name", { exact: false })).toHaveValue(
      "Keep my original draft",
    );
    await expect(editor.getByLabel("Name", { exact: false })).toBeDisabled();
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await editor.screenshot({
      path: test.info().outputPath("skills-import-review-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const action = editor.getByRole("button", {
      name: "Import text only",
      exact: true,
    });
    await expect(action).toBeVisible();
    const actionBox = await action.boundingBox();
    expect(actionBox).toBeTruthy();
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(390);
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(844);
    await expectDialogCloseControls(editor, "Create skill");
    await page.screenshot({
      path: test.info().outputPath("skills-import-review-mobile.png"),
    });
    await editor
      .getByRole("button", { name: "Cancel import", exact: true })
      .click();
    await expect(
      editor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue("Do not discard these instructions.");
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(imported);
    await action.click();
    await expect(editor.getByLabel("Name", { exact: false })).toHaveValue(
      "Проверка 🙂",
    );
    await expect(
      editor.getByLabel("Description", { exact: false }),
    ).toHaveValue("");
    await expect(
      editor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue(body);
    await expect(
      editor.getByText("Export description: Review guidance for Проверка 🙂.", {
        exact: true,
      }),
    ).toBeVisible();
    const event = page.waitForEvent("download");
    await editor
      .getByRole("button", { name: "Export SKILL.md", exact: true })
      .click();
    const download = await event;
    const path = test.info().outputPath("portable-empty-description-SKILL.md");
    await download.saveAs(path);
    expect(await readFile(path, "utf8")).toBe(
      `---\nname: "review-skill"\ndescription: "Review guidance for Проверка 🙂."\n---\n${body}`,
    );
    await expect(
      editor.getByLabel("Description", { exact: false }),
    ).toHaveValue("");
  });

  test("Skills rejects unsupported imports without losing text and labels companion exports as drafts", async ({
    page,
  }) => {
    await openLibrary(page);
    await page
      .getByRole("button", { name: "Create skill", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "Create skill",
      exact: true,
    });
    await editor
      .getByLabel("Name", { exact: false })
      .fill("Preserved original");
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill("Original review instructions.");
    const file = (header: string, body: string) => ({
      name: "SKILL.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        `---\nname: imported\ndescription: test\n${header}---\n${body}`,
      ),
    });
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(file("allowed-tools: Bash\n", "Review."));
    await expect(editor.getByRole("alert")).toContainText(
      "Unsupported frontmatter",
    );
    await expect(editor.getByLabel("Name", { exact: false })).toHaveValue(
      "Preserved original",
    );
    await editor
      .getByLabel("Import SKILL.md", { exact: false })
      .setInputFiles(file("", "[Reference\nguide](references/guide.md)"));
    await expect(editor.getByRole("alert")).toContainText("companion files");
    await expect(editor.getByRole("alert")).toContainText(
      "Import not applied. Your current draft is unchanged.",
    );
    await expect(
      editor.getByLabel("Markdown instructions", { exact: false }),
    ).toHaveValue("Original review instructions.");
    await page.setViewportSize({ width: 390, height: 844 });
    await editor.getByRole("alert").scrollIntoViewIfNeeded();
    await editor.screenshot({
      path: test.info().outputPath("skills-import-resource-error-mobile.png"),
    });
    const localBody = "## Local draft\n[Guide](references/guide.md)\n";
    await editor
      .getByLabel("Markdown instructions", { exact: false })
      .fill(localBody);
    await expect(
      editor.getByRole("button", { name: "Export SKILL.md", exact: true }),
    ).toHaveCount(0);
    const event = page.waitForEvent("download");
    await editor
      .getByRole("button", { name: "Download draft", exact: true })
      .click();
    const download = await event;
    expect(download.suggestedFilename()).toBe("SKILL.draft.md");
    const path = test.info().outputPath("companion-SKILL.draft.md");
    await download.saveAs(path);
    expect((await readFile(path, "utf8")).split("\n---\n")[1]).toBe(localBody);
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
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
