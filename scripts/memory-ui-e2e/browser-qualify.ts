import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page, type Route } from "playwright-core";
import { memoryKnowledgePreviewData } from "../../apps/web/src/features/memory/interface/components/memory-knowledge-preview-data";
import {
  memoryOperationMessage,
  type MemoryDashboardMutation,
  type MemoryEntryView,
  type MemoryKnowledgePage,
  type MemoryOperationView,
} from "../../apps/web/src/features/memory/application/memory-knowledge-view";

// UI-only synthetic HTTP fixtures. This proves rendered interaction, not product
// authorization, persistence, native processing, model quality or deployment.
const origin = new URL(
  process.env.REVIEW_ROUTER_MEMORY_UI_ORIGIN ?? "http://127.0.0.1:3001",
);
assert(
  origin.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(origin.hostname),
  "Memory UI qualification only accepts a local disposable preview.",
);
const output = resolve(
  process.env.REVIEW_ROUTER_MEMORY_UI_OUTPUT ?? "tmp/memory-ui-e2e",
);
await mkdir(output, { recursive: true });
const screenshots: {
  name: string;
  path: string;
  width: number;
  height: number;
}[] = [];
const checkpoints: string[] = [];
const failures: string[] = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.REVIEW_ROUTER_MEMORY_UI_CHROMIUM
    ? { executablePath: process.env.REVIEW_ROUTER_MEMORY_UI_CHROMIUM }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const browserVersion = browser.version();

class Fixture {
  pages = new Map<string, MemoryKnowledgePage>();
  commands = new Map<
    string,
    { input: MemoryDashboardMutation; operation: MemoryOperationView }
  >();
  posts: MemoryDashboardMutation[] = [];
  failPosts = 0;
  showProgress = true;
  page(repositoryId: string | null): MemoryKnowledgePage {
    const key = repositoryId ?? "workspace";
    if (!this.pages.has(key))
      this.pages.set(key, memoryKnowledgePreviewData(repositoryId));
    return this.pages.get(key)!;
  }
  finish(commandId: string) {
    const command = this.commands.get(commandId)!;
    assert(command);
    const { input, operation } = command;
    const page = this.page(input.repositoryId);
    const state = input.action === "save" ? "published" : "completed";
    command.operation = {
      ...operation,
      state,
      message: memoryOperationMessage(state),
    };
    this.pages.set(input.repositoryId ?? "workspace", {
      ...page,
      entries: page.entries.map((entry) =>
        entry.id !== operation.entryId
          ? entry
          : {
              ...entry,
              pendingCommandId: null,
              ...(input.action === "save"
                ? { body: input.body, topics: input.topics, unavailable: null }
                : input.action === "forget"
                  ? { body: null, topics: [], status: "forgotten" as const }
                  : { status: "retired" as const }),
            },
      ),
    });
  }
  async route(route: Route) {
    const request = route.request();
    const query = new URL(request.url()).searchParams;
    if (request.method() === "POST") {
      const input = request.postDataJSON() as MemoryDashboardMutation;
      assert.equal(input.workspaceId, "workspace_preview");
      this.posts.push(input);
      let command = this.commands.get(input.commandId);
      if (command)
        assert.deepEqual(
          command.input,
          input,
          "Retry changed the original approval.",
        );
      else {
        const page = this.page(input.repositoryId);
        const entryId =
          input.entryId ?? `mem_${input.commandId.replaceAll("-", "")}`;
        const previous = page.entries.find((entry) => entry.id === entryId);
        const revision = previous
          ? `${previous.revision}_next`
          : "fixture_revision_1";
        const state =
          input.action === "forget"
            ? "cleanup_pending"
            : input.action === "retire"
              ? "completed"
              : "queued";
        const operation: MemoryOperationView = {
          id: input.commandId,
          entryId,
          revision,
          state,
          message: memoryOperationMessage(state),
        };
        const entry: MemoryEntryView = {
          ...(previous ?? memoryKnowledgePreviewData().entries[0]!),
          id: entryId,
          revision,
          body:
            input.action === "save" || input.action === "forget"
              ? null
              : (previous?.body ?? null),
          topics:
            input.action === "save" || input.action === "forget"
              ? []
              : (previous?.topics ?? []),
          pendingCommandId: state === "completed" ? null : input.commandId,
          status:
            input.action === "forget"
              ? "forget_pending"
              : input.action === "retire"
                ? "retired"
                : "active",
          unavailable: input.action === "save" ? "unsettled" : null,
        };
        this.pages.set(input.repositoryId ?? "workspace", {
          ...page,
          entries: [
            entry,
            ...page.entries.filter((item) => item.id !== entryId),
          ],
        });
        command = { input, operation };
        this.commands.set(input.commandId, command);
      }
      if (this.failPosts-- > 0) return route.abort("failed");
      return route.fulfill({ json: command.operation });
    }
    assert.equal(request.method(), "GET");
    const repositoryId = query.get("repositoryId");
    const commandId = query.get("commandId");
    if (commandId) {
      const command = this.commands.get(commandId);
      if (!this.showProgress || !command)
        return route.fulfill({
          status: 404,
          json: { error: "memory_not_found" },
        });
      assert.equal(
        command.input.repositoryId,
        repositoryId,
        "Progress crossed a scope boundary.",
      );
      return route.fulfill({ json: command.operation });
    }
    const page = this.page(repositoryId);
    const topicId = query.get("topicId");
    return route.fulfill({
      json: {
        ...page,
        topicId,
        entries: topicId
          ? page.entries.filter((entry) => entry.topics.includes(topicId))
          : page.entries,
      },
    });
  }
}

async function visible(page: Page, text: string) {
  await page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}
async function capture(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    contentWidth: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.contentWidth <= dimensions.width + 1,
    `${name}: horizontal document overflow`,
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count())
    assert(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
      `${name}: dialog overflow`,
    );
  const path = resolve(output, `${name}.png`);
  await page.screenshot({ path, fullPage, animations: "disabled" });
  screenshots.push({
    name,
    path,
    width: dimensions.width,
    height: dimensions.height,
  });
}
async function scope(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Show knowledge for" }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await page
    .getByRole("combobox", { name: "Show knowledge for" })
    .filter({ hasText: name })
    .waitFor({ state: "visible" });
}
async function start(page: Page, fixture: Fixture) {
  await page.route("**/api/memory-preview-fixture**", (route) =>
    fixture.route(route),
  );
  await page.goto(`${origin.origin}/dashboard/memory-preview?fixture=http`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await visible(
    page,
    "UI-only API fixture · synthetic changes stay in this test",
  );
  await page
    .locator('[data-memory-preview-ready="true"]')
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("heading", { name: "Memory", exact: true }).waitFor();
}

try {
  for (const [name, viewport] of [
    ["narrow", { width: 390, height: 844 }],
    ["desktop", { width: 1440, height: 1100 }],
  ] as const) {
    const context = await browser.newContext({
      viewport,
      colorScheme: "dark",
      reducedMotion: "reduce",
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const fixture = new Fixture();
    page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`));
    try {
      await start(page, fixture);
      await visible(page, "Historical observation");
      assert(
        (
          await page
            .getByRole("link", { name: /GitHub discussion/ })
            .first()
            .getAttribute("href")
        )?.startsWith("https://github.com/"),
      );
      await capture(page, `${name}-list`);
      const add = page.getByRole("button", { name: "Add memory", exact: true });
      await add.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.getByRole("button", { name: "Submit memory" }).click();
      await visible(page, "Enter a rule to remember.");
      assert(
        await page
          .getByLabel("Memory text", { exact: true })
          .evaluate((element) => document.activeElement === element),
      );
      await capture(page, `${name}-editor-validation`, false);
      for (let index = 0; index < 7; index++) {
        await page.keyboard.press("Tab");
        // The shared primitive redirects its outside tab sentinel on the next frame.
        await page.waitForFunction(
          () =>
            document
              .querySelector('[role="dialog"]')
              ?.contains(document.activeElement),
          undefined,
          { timeout: 2_000 },
        );
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(
        await add.evaluate((element) => document.activeElement === element),
        "Closing the modal did not restore keyboard focus.",
      );
      checkpoints.push(`${name}:keyboard-validation-focus-trap-escape-return`);
      await scope(page, "acme/platform");
      await capture(page, `${name}-repository`);
      await scope(page, "Workspace · shared rules");
      await add.click();
      const body =
        "Store event timestamps in UTC and convert them only for display.";
      const longTopic = "topic_" + "a".repeat(94);
      await page.getByLabel("Memory text", { exact: true }).fill(body);
      await page.getByLabel(/Topics/).fill(`database, ${longTopic}`);
      await page.getByRole("button", { name: "Submit memory" }).click();
      await visible(page, memoryOperationMessage("queued"));
      const save = fixture.posts.at(-1)!;
      assert.equal(save.action, "save");
      await capture(page, `${name}-queued`);
      fixture.finish(save.commandId);
      await visible(page, memoryOperationMessage("published"));
      await visible(page, body);
      await capture(page, `${name}-published-long-topic`);
      await page.getByLabel("Filter by topic").fill("database");
      await page.getByRole("button", { name: "Apply filter" }).click();
      await visible(
        page,
        "Showing stored knowledge tagged database. Select All entries to check changes that are still processing.",
      );
      await page
        .getByRole("button", { name: "All entries", exact: true })
        .click();
      const entry = page.locator("article").filter({ hasText: body });
      await entry
        .getByRole("button", { name: "Stop using", exact: true })
        .click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(
        fixture.posts.length,
        1,
        "Cancellation submitted a mutation.",
      );
      await entry
        .getByRole("button", { name: "Stop using", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop using memory", exact: true })
        .click();
      await entry.getByText("Not used", { exact: true }).waitFor();
      await capture(page, `${name}-retired`);
      await entry.getByRole("button", { name: "Forget", exact: true }).click();
      await page
        .getByRole("button", { name: "Forget memory", exact: true })
        .click();
      await page.getByText("Forgetting", { exact: true }).waitFor();
      await capture(page, `${name}-cleanup-pending`);
      fixture.finish(fixture.posts.at(-1)!.commandId);
      await visible(page, "This memory has been forgotten.");
      assert(
        !(
          await page
            .locator("section[aria-label='Memory management']")
            .innerText()
        ).includes(body),
        "Forgotten body is still visible.",
      );
      await capture(page, `${name}-forgotten`);
      checkpoints.push(`${name}:scope-topic-save-publication-retire-forget`);
    } catch (error) {
      await capture(page, `${name}-failure`, false).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }

    const recoveryContext = await browser.newContext({
      viewport,
      colorScheme: "dark",
      timezoneId: "UTC",
    });
    const recovery = await recoveryContext.newPage();
    recovery.setDefaultTimeout(60_000);
    recovery.on("pageerror", (error) =>
      failures.push(`${name}/recovery: ${error.message}`),
    );
    const interrupted = new Fixture();
    interrupted.failPosts = 2;
    interrupted.showProgress = false;
    try {
      await start(recovery, interrupted);
      await recovery
        .getByRole("button", { name: "Edit", exact: true })
        .first()
        .click();
      const body = "Use a bounded timeout for every database request.";
      await recovery.getByLabel("Memory text", { exact: true }).fill(body);
      await recovery.getByRole("button", { name: "Submit memory" }).click();
      await recovery.getByRole("alert").waitFor();
      await recovery
        .getByRole("button", { name: "Close and check status" })
        .click();
      await scope(recovery, "acme/platform");
      assert.equal(
        await recovery
          .getByRole("button", { name: "Resume same request" })
          .count(),
        0,
      );
      await scope(recovery, "Workspace · shared rules");
      await recovery
        .getByRole("button", { name: "Resume same request" })
        .click();
      assert.equal(
        await recovery.getByLabel("Memory text", { exact: true }).inputValue(),
        body,
      );
      assert(
        await recovery.getByLabel("Memory text", { exact: true }).isDisabled(),
      );
      await recovery
        .getByRole("button", { name: "Retry same request" })
        .click();
      await recovery.getByRole("alert").waitFor();
      assert.equal(interrupted.posts.length, 2);
      assert.deepEqual(
        interrupted.posts[1],
        interrupted.posts[0],
        "Resuming changed the approved request.",
      );
      await capture(recovery, `${name}-ambiguous-resume`, false);
      await recovery
        .getByRole("button", { name: "Close and check status" })
        .click();
      const original = interrupted.commands.get(
        interrupted.posts[0]!.commandId,
      )!;
      original.operation = {
        ...original.operation,
        state: "unknown",
        message: memoryOperationMessage("unknown"),
      };
      await recovery
        .getByRole("button", { name: "Check status again" })
        .waitFor({ state: "visible" });
      interrupted.showProgress = true;
      await recovery
        .getByRole("button", { name: "Check status again" })
        .click();
      await visible(recovery, memoryOperationMessage("unknown"));
      await recovery
        .getByRole("button", { name: "Resume same request" })
        .waitFor({ state: "hidden" });
      const affected = recovery.locator("article").first();
      await affected
        .getByRole("button", { name: "Forget", exact: true })
        .waitFor();
      await capture(recovery, `${name}-unknown-urgent-removal`);
      await affected
        .getByRole("button", { name: "Forget", exact: true })
        .click();
      await recovery
        .getByRole("button", { name: "Forget memory", exact: true })
        .click();
      await visible(recovery, memoryOperationMessage("cleanup_pending"));
      const urgent = interrupted.posts.at(-1)!;
      assert.equal(urgent.action, "forget");
      assert.notEqual(urgent.commandId, original.input.commandId);
      assert.equal(urgent.expectedRevision, original.operation.revision);
      checkpoints.push(
        `${name}:lost-post-close-scope-exact-retry-confirmed-unknown-fresh-cas-forget`,
      );
    } catch (error) {
      await capture(recovery, `${name}-recovery-failure`, false).catch(
        () => undefined,
      );
      throw error;
    } finally {
      await recoveryContext.close();
    }
  }
  assert.equal(
    checkpoints.length,
    6,
    "Both viewport scenarios must complete every checkpoint.",
  );
  assert.deepEqual(failures, [], "The rendered page raised client errors.");
} catch (error) {
  failures.push(
    error instanceof Error ? error.message : "Unknown UI qualification failure",
  );
  throw error;
} finally {
  await writeFile(
    resolve(output, "evidence.json"),
    JSON.stringify(
      {
        schema: "memory-ui-qualification/v1",
        evidenceKind: "rendered-next-preview-synthetic-http-fixtures",
        productAuthorityQualified: false,
        nativeProviderQualified: false,
        realModelQualified: false,
        passed: failures.length === 0 && checkpoints.length === 6,
        browserVersion,
        checkpoints,
        screenshots,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
console.log(
  `Memory UI qualification passed ${checkpoints.length} checkpoints with ${screenshots.length} screenshots (${browserVersion}).`,
);
