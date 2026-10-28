import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright-core";

/** The caller supplies an already authenticated, explicitly owned test tab.
 * This suite does not launch/attach a profile, read credentials or call APIs.
 * Production execution requires a disposable connection prefix and an owner.
 */
export interface ContextToolsBrowserAcceptanceInput {
  page: Page;
  origin: string;
  workspaceId: string;
  connectionPrefix: string;
  outputDirectory: string;
  /** A second explicitly owned authenticated tab for real revision conflicts. */
  stalePage?: Page;
  presets: readonly {
    label: string;
    tool: string;
    endpoint: string;
    /** Omit when this endpoint is not in the immutable upstream UAP catalog. */
    catalogName?: string;
  }[];
  /** Optional real HTTPS fixture known to return HTTP 401 without credentials. */
  authenticationFailureEndpoint?: string;
}

interface VisualEvidence {
  viewport: "desktop" | "mobile";
  theme: "light" | "dark";
  screenshot: string;
  clientWidth: number;
  scrollWidth: number;
}

interface CaseEvidence {
  connectionId: string;
  preset: string;
  endpoint: string;
  selectedTool: string;
  realProbeSucceeded: boolean;
  uiSaveSucceeded: boolean;
  advancedRoundtripPreserved: boolean;
  disabledAfterTest: boolean;
}

const form = (page: Page, name: string) =>
  page.getByRole("form", { name, exact: true });
const toolPattern = (name: string) =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);

async function waitForText(
  locator: Locator,
  pattern: RegExp,
  timeout = 30_000,
): Promise<string> {
  await locator.filter({ hasText: pattern }).first().waitFor({
    state: "visible",
    timeout,
  });
  return (await locator.allTextContents()).join("\n");
}

async function advancedDefinition(
  editor: Locator,
  label: string,
): Promise<Record<string, unknown>> {
  const field = editor.getByRole("textbox", { name: label, exact: true });
  if (!(await field.isVisible())) {
    await editor.getByText("Advanced JSON", { exact: true }).click();
  }
  const value: unknown = JSON.parse(await field.inputValue());
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function save(editor: Locator): Promise<void> {
  await editor
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await waitForText(editor.getByRole("status"), /Connection saved\./);
}

async function disable(page: Page, connectionId: string): Promise<void> {
  const editor = form(page, `${connectionId} connection`);
  await editor.waitFor({ state: "visible" });
  await editor
    .getByRole("checkbox", {
      name: "Enabled for policy selection",
      exact: true,
    })
    .uncheck();
  await save(editor);
}

/** Runs only actual form interactions. No network interception or mock success.
 * The caller must separately inspect visual screenshots and run the normal
 * repository-policy/OCR canary; this suite makes no model-call claim.
 */
export async function runContextToolsBrowserAcceptance(
  input: ContextToolsBrowserAcceptanceInput,
): Promise<{ visual: VisualEvidence[]; cases: CaseEvidence[] }> {
  const { page } = input;
  const origin = new URL(input.origin);
  assert.equal(origin.origin, input.origin);
  assert.equal(origin.protocol, "https:");
  assert(
    /^[a-z][a-z0-9_]{5,20}$/.test(input.connectionPrefix),
    "Use a unique disposable connection prefix.",
  );
  assert(input.workspaceId.length > 0 && input.presets.length > 0);
  for (const preset of input.presets) {
    assert.equal(new URL(preset.endpoint).protocol, "https:");
    assert(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(preset.tool));
  }
  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const url = `${origin.origin}/dashboard/context-tools?${new URLSearchParams({ workspaceId: input.workspaceId })}`;
  const created = new Set<string>();
  const visual: VisualEvidence[] = [];
  const cases: CaseEvidence[] = [];
  const cleanupErrors: string[] = [];
  let failure: unknown;
  const originalViewport = page.viewportSize();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await form(page, "New connection").waitFor({ state: "visible" });
  const originalTheme = await page.evaluate(() =>
    localStorage.getItem("reviewrouter-theme"),
  );
  try {
    for (const viewport of ["desktop", "mobile"] as const) {
      await page.setViewportSize(
        viewport === "desktop"
          ? { width: 1440, height: 1100 }
          : { width: 390, height: 844 },
      );
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate(
          (value) => localStorage.setItem("reviewrouter-theme", value),
          theme,
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await form(page, "New connection").waitFor({ state: "visible" });
        await page.waitForFunction(
          (value) => document.documentElement.dataset.theme === value,
          theme,
        );
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert(
          dimensions.scrollWidth <= dimensions.clientWidth + 1,
          `${viewport}/${theme} horizontal overflow`,
        );
        const screenshot = resolve(outputDirectory, `${viewport}-${theme}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        visual.push({ viewport, theme, screenshot, ...dimensions });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1100 });

    // The endpoint is typed in the real form and tested by its real server probe.
    for (const [index, preset] of input.presets.entries()) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      let editor = form(page, "New connection");
      const connectionId = `${input.connectionPrefix}_${index}`;
      assert(connectionId.length <= 32);
      assert.equal(
        await form(page, `${connectionId} connection`).count(),
        0,
        "Disposable connection ID already exists; choose a fresh prefix.",
      );
      if (preset.catalogName) {
        await editor
          .getByRole("combobox", { name: /^Start from the UAP catalog/ })
          .click();
        await page
          .getByRole("option", { name: preset.catalogName, exact: true })
          .click();
        await editor
          .getByRole("button", {
            name: `Use ${preset.catalogName}`,
            exact: true,
          })
          .click();
      } else {
        await editor
          .getByRole("textbox", { name: /^HTTPS MCP URL/ })
          .fill(preset.endpoint);
      }
      await editor
        .getByRole("textbox", { name: /^Connection ID/ })
        .fill(connectionId);
      assert.equal(
        await editor
          .getByRole("textbox", { name: /^HTTPS MCP URL/ })
          .inputValue(),
        preset.endpoint,
      );
      await editor
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      const approved = editor.getByRole("group", {
        name: "Approved tools",
        exact: true,
      });
      await approved
        .getByRole("checkbox", { name: toolPattern(preset.tool) })
        .waitFor({ state: "visible", timeout: 30_000 });
      for (const checkbox of await approved.getByRole("checkbox").all()) {
        await checkbox.uncheck();
      }
      await approved
        .getByRole("checkbox", { name: toolPattern(preset.tool) })
        .check();
      const before = await advancedDefinition(
        editor,
        "New connection definition",
      );
      assert.equal(before.id, connectionId);
      assert.equal(before.url, preset.endpoint);
      assert.deepEqual(before.tools, [preset.tool]);
      // Rewrite through Advanced JSON, return to normal fields, then save.
      await editor
        .getByRole("textbox", {
          name: "New connection definition",
          exact: true,
        })
        .fill(JSON.stringify(before, null, 2));
      await editor.getByText("Advanced JSON", { exact: true }).click();
      assert.equal(
        await editor
          .getByRole("textbox", { name: /^HTTPS MCP URL/ })
          .inputValue(),
        preset.endpoint,
      );
      // Track before issuing save: a transport error after persistence needs cleanup.
      created.add(connectionId);
      await save(editor);
      await page.reload({ waitUntil: "domcontentloaded" });
      editor = form(page, `${connectionId} connection`);
      await editor.waitFor({ state: "visible" });
      const after = await advancedDefinition(
        editor,
        `${connectionId} definition`,
      );
      assert.deepEqual(
        after,
        before,
        "Guided/JSON/save roundtrip changed the definition.",
      );
      if (input.stalePage) {
        await input.stalePage.goto(url, { waitUntil: "domcontentloaded" });
        await form(input.stalePage, `${connectionId} connection`).waitFor({
          state: "visible",
        });
      }
      await disable(page, connectionId);
      if (input.stalePage) {
        const staleEditor = form(input.stalePage, `${connectionId} connection`);
        await staleEditor
          .getByRole("button", { name: "Save connection", exact: true })
          .click();
        await waitForText(
          staleEditor.getByRole("alert"),
          /Configuration changed\. Reload/,
        );
        await staleEditor
          .getByRole("button", { name: "Test connection", exact: true })
          .click();
        await waitForText(
          staleEditor.getByRole("alert"),
          /Configuration changed\. Reload/,
        );
      }
      created.delete(connectionId);
      cases.push({
        connectionId,
        preset: preset.label,
        endpoint: preset.endpoint,
        selectedTool: preset.tool,
        realProbeSucceeded: true,
        uiSaveSucceeded: true,
        advancedRoundtripPreserved: true,
        disabledAfterTest: true,
      });
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    const editor = form(page, "New connection");
    await editor
      .getByRole("textbox", { name: /^Connection ID/ })
      .fill(`${input.connectionPrefix}_deny`);
    for (const endpoint of [
      "https://127.0.0.1/mcp",
      "https://169.254.169.254/mcp",
      "http://localhost:3000/mcp",
    ]) {
      await editor
        .getByRole("textbox", { name: /^HTTPS MCP URL/ })
        .fill(endpoint);
      await editor
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await waitForText(
        editor.getByRole("alert"),
        /invalid|private|public|HTTPS|could not|not allowed/i,
      );
      assert.equal(
        await editor
          .getByRole("group", { name: "Approved tools", exact: true })
          .getByRole("checkbox")
          .count(),
        0,
      );
    }
    if (input.authenticationFailureEndpoint) {
      assert.equal(
        new URL(input.authenticationFailureEndpoint).protocol,
        "https:",
      );
      await editor
        .getByRole("textbox", { name: /^HTTPS MCP URL/ })
        .fill(input.authenticationFailureEndpoint);
      await editor
        .getByRole("button", { name: "Test connection", exact: true })
        .click();
      await waitForText(editor.getByRole("alert"), /refused authentication/);
    }
  } catch (error: unknown) {
    failure = error;
  } finally {
    for (const connectionId of created) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await disable(page, connectionId);
      } catch {
        cleanupErrors.push(connectionId);
      }
    }
    const restoreErrors: string[] = [];
    const writeEvidence = (restoring: boolean) =>
      writeFile(
        resolve(outputDirectory, "acceptance.public.json"),
        JSON.stringify(
          {
            status:
              restoring ||
              failure ||
              cleanupErrors.length ||
              restoreErrors.length
                ? "INCOMPLETE"
                : "PASSED",
            visual,
            cases,
            invalidEndpointsTested: !failure,
            authenticationFailureTested:
              !failure && !!input.authenticationFailureEndpoint,
            staleRevisionTested: !failure && !!input.stalePage,
            cleanupErrors,
            restoreErrors,
            modelCalls: 0,
            toolCalls: 0,
            actualOcrProof: "separate required canary",
            credentialValuesRead: false,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    // Preserve cleanup IDs before touching a possibly closed or crashed page.
    try {
      await writeEvidence(true);
    } catch (error) {
      failure ??= error;
    }
    const restoreSteps: readonly (readonly [string, () => Promise<unknown>])[] =
      [
        [
          "theme",
          () =>
            page.evaluate((theme) => {
              if (theme === null) localStorage.removeItem("reviewrouter-theme");
              else localStorage.setItem("reviewrouter-theme", theme);
            }, originalTheme),
        ],
        [
          "viewport",
          async () => {
            if (originalViewport) await page.setViewportSize(originalViewport);
          },
        ],
        ["reload", () => page.reload({ waitUntil: "domcontentloaded" })],
      ];
    for (const [name, restore] of restoreSteps) {
      try {
        await restore();
      } catch {
        restoreErrors.push(name);
      }
    }
    try {
      await writeEvidence(false);
    } catch (error) {
      failure ??= error;
    }
    if (restoreErrors.length && !failure) {
      failure = new Error(
        `Browser restoration failed: ${restoreErrors.join(", ")}`,
      );
    }
  }
  if (failure) throw failure;
  assert.deepEqual(
    cleanupErrors,
    [],
    "Disable remaining disposable connections before continuing.",
  );
  return { visual, cases };
}
