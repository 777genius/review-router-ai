import { expect, test, type Page } from "@playwright/test";
import {
  chooseSetupOption as select,
  openNewProvider,
} from "./provider-setup-support.ts";
import {
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
  useOtherSession,
} from "./support.ts";
import { FIXTURES } from "../contracts.ts";

test.describe("Gateway connection test", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 60_000, navigationTimeout: 90_000 });
  test.skip(
    process.env.ACCOUNTS_REFERENCE_E2E_PROBE !== "1",
    "Requires the opt-in --probe-fixture harness.",
  );
  async function stats(mode?: string) {
    const response = await fetch(
      `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__probe-fixture`,
      mode
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          }
        : {},
    );
    return (await response.json()) as {
      preparations: number;
      requests: number;
      closes: number;
    };
  }
  async function open(page: Page) {
    const dialog = await openNewProvider(page, FIXTURES.workspaces.orgAlpha);
    await select(page, "Provider", "MiMo Token Plan");
    await dialog.getByRole("radio", { name: /^ReviewRouter/ }).check();
    await select(page, "Account", "RR E2E Viewer Primary");
    await select(page, "Model", "rr-e2e-model");
    await expect(
      page.getByRole("button", { name: "Test connection", exact: true }),
    ).toBeEnabled();
  }
  test("shared account sends one real HTTP request; spinner, streamed stages and success render on desktop and mobile", async ({
    page,
    context,
  }, info) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await stats("ok");
    const dialog = await openNewProvider(page, FIXTURES.workspaces.orgAlpha);
    await select(page, "Provider", "MiMo Token Plan");
    await dialog.getByRole("radio", { name: /^GitHub Secrets/ }).check();
    await expect(
      page.getByRole("button", { name: "Test connection", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("radio", { name: /^ReviewRouter/ }).check();
    await expect(
      dialog.getByRole("combobox", { name: "Model", exact: true }),
    ).toHaveCount(0);
    await select(page, "Account", "RR E2E Viewer Primary");
    await select(page, "Model", "rr-e2e-model");
    const before = await stats();
    const posts: unknown[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/dashboard/accounts/test")
        posts.push(request.postDataJSON());
    });
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    const running = page.getByRole("button", {
      name: "Testing connection…",
      exact: true,
    });
    await expect(running).toBeDisabled();
    await expect(running.locator("svg.animate-spin")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Connection test progress" }),
    ).toBeVisible();
    await info.attach("desktop-progress", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await expect(page.getByText(/Model answered · rr-e2e-model/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test connection", exact: true }),
    ).toBeEnabled();
    const after = await stats();
    expect(after.requests - before.requests).toBe(1);
    expect(after.closes - before.closes).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      workspaceId: FIXTURES.workspaces.orgAlpha,
      bindingId: FIXTURES.bindings.viewerAlpha,
      model: "rr-e2e-model",
    });
    expect(JSON.stringify(posts)).not.toMatch(
      /bearer|credential|apiKey|accountRef/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByText(/Model answered · rr-e2e-model/)
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach("mobile-success", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    // Changing the account aborts an in-flight test, discards its old success,
    // clears the model, and cannot attach a late result to the new selection.
    await stats("slow");
    const changing = await stats();
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect
      .poll(async () => (await stats()).requests)
      .toBe(changing.requests + 1);
    await select(page, "Account", "RR E2E Org Alpha Owned");
    await expect
      .poll(async () => (await stats()).closes)
      .toBe(changing.closes + 1);
    await expect(
      page.getByRole("list", { name: "Connection test progress" }),
    ).toHaveCount(0);
    await expect(page.getByText(/Model answered/)).toHaveCount(0);
    // This account has one authorized model; selecting it chooses that model
    // without automatically dispatching inference or retaining the old result.
    expect((await stats()).requests).toBe(changing.requests + 1);
    await dialog.getByRole("radio", { name: /^GitHub Secrets/ }).check();
    await expect(
      page.getByRole("button", { name: "Test connection", exact: true }),
    ).toHaveCount(0);
    expect(violations).toEqual([]);
  });
  test("failed generation never shows success; cancel aborts and closes; foreign binding and CSRF never dispatch", async ({
    page,
    context,
  }) => {
    await useViewerSession(context);
    await stats("failed");
    await open(page);
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "did not return a complete text response" }),
    ).toBeVisible();
    await expect(page.getByText(/Model answered/)).toHaveCount(0);
    await stats("slow");
    const before = await stats();
    const sent = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/dashboard/accounts/test",
    );
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    const original = (await sent).postDataJSON();
    await expect
      .poll(async () => (await stats()).requests)
      .toBe(before.requests + 1);
    await page.getByRole("button", { name: "Cancel test" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Test cancelled" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await stats()).closes)
      .toBe(before.closes + 1);
    const after = await stats();
    const crossSite = await context.request.post(
      "/api/dashboard/accounts/test",
      { headers: { origin: "https://foreign.invalid" }, data: original },
    );
    expect(crossSite.status()).toBe(403);
    await useOtherSession(context);
    // Same old viewer context + foreign borrower workspace must fail closed.
    const denied = await page.evaluate(async (request) => {
      const response = await fetch("/api/dashboard/accounts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, nonce: crypto.randomUUID() }),
      });
      return await response.text();
    }, original);
    expect(denied).toContain('"code":"denied"');
    expect((await stats()).requests).toBe(after.requests);
    expect((await stats()).preparations).toBe(after.preparations);
  });
});
