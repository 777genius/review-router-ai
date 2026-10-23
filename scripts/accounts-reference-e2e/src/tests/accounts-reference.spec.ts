import { withDatabase } from "../database.ts";
import { FIXTURES } from "../contracts.ts";
import { expect, test } from "@playwright/test";
import {
  activeElementInside,
  browserRequestsFor,
  bodyScrollLocked,
  dialogFor,
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  openAccounts,
  organizationAccountsRegion,
  sourceRow,
  useOtherSession,
  useViewerSession,
} from "./support.ts";

test.describe("Accounts UX reference browser contract", () => {
  test.afterEach(async ({ page }, info) => {
    await info.attach("browser-requests", {
      body: Buffer.from(JSON.stringify(browserRequestsFor(page), null, 2)),
      contentType: "application/json",
    });
    await info.attach("rendered-ui", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
  test("harness boot, generated session, and external-network isolation", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-personal-viewer");
    await expect(
      page.getByRole("heading", { name: "My connections" }),
    ).toBeVisible();
    await expect(
      page.getByText("RR E2E Viewer Primary", { exact: true }),
    ).toBeVisible();
    await expectNetworkViolations(violations);
  });

  test("personal workspace shows viewer-owned source once and never foreign or org sources", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-personal-viewer");
    const row = sourceRow(page, "RR E2E Viewer Primary");
    await expect(row).toHaveCount(1);
    await expect(
      page.getByText("RR E2E Viewer Primary", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("RR E2E Foreign Personal", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("RR E2E Org Alpha Owned", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("RR E2E Other Person Primary", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("tab")
        .filter({ hasText: /My connections|Available in this workspace/ }),
    ).toHaveCount(0);
    // Org badges draw the mini avatar in the chip corner (UX batch 3); the chip
    // must not clip it away (UX batch 4).
    for (const organization of ["RR E2E Org Alpha", "RR E2E Org Bravo"]) {
      const chip = row.locator(`a[title="${organization}"]`);
      await expect(chip.locator('img[alt=""]')).toHaveCount(1);
      expect(
        await chip.evaluate((element) => getComputedStyle(element).overflow),
      ).toBe("visible");
    }
    await expectNetworkViolations(violations);
  });

  test("organization list combines safe rows with neutral owner labels and avatar semantics", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-org-alpha");
    const region = organizationAccountsRegion(page);
    await expect(region).toHaveCount(1);
    for (const label of [
      "RR E2E Viewer Primary",
      "RR E2E Other Person Primary",
      "RR E2E Org Alpha Owned",
    ]) {
      await expect(sourceRow(page, label, region)).toHaveCount(1);
    }
    const viewerRow = sourceRow(page, "RR E2E Viewer Primary", region);
    await expect(viewerRow.getByText(/^You$/)).toBeVisible();
    await expect(viewerRow.locator('img[alt=""]')).toHaveCount(1);
    await expect(viewerRow.getByText(/rr-e2e-other-person/i)).toHaveCount(0);
    await expect(
      sourceRow(page, "RR E2E Other Person Primary", region).getByText(
        /rr-e2e-other-person/i,
      ),
    ).toBeVisible();
    await expect(
      sourceRow(page, "RR E2E Org Alpha Owned", region).getByText(
        "RR E2E Org Alpha",
        { exact: true },
      ),
    ).toBeVisible();
    // The organization owner draws its workspace avatar in the Owner column
    // (UX batch 4).
    await expect(
      sourceRow(page, "RR E2E Org Alpha Owned", region).locator('img[alt=""]'),
    ).toHaveCount(1);
    const ownerAccessibility = await viewerRow.evaluate((row) => {
      const nodes = [...row.querySelectorAll("img, [aria-label]")];
      return nodes.flatMap((node) => [
        node.getAttribute("aria-label") ?? "",
        node.getAttribute("alt") ?? "",
      ]);
    });
    expect(
      ownerAccessibility.filter((value) => /github|gitlab/i.test(value)),
    ).toEqual([]);
    const fixtureDatabase =
      process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!;
    try {
      await withDatabase(fixtureDatabase, (db) =>
        db.query('UPDATE "WorkspaceMember" SET role=$1 WHERE id=$2', [
          "member",
          "rr-e2e-member-other-alpha",
        ]),
      );
      await region
        .getByRole("button", { name: "Refresh connections", exact: true })
        .last()
        .click();
      await expect(
        sourceRow(page, "RR E2E Other Person Primary", region),
      ).toHaveCount(0);
      await expect(
        region.getByText("@rr-e2e-other-person", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await withDatabase(fixtureDatabase, (db) =>
        db.query('UPDATE "WorkspaceMember" SET role=$1 WHERE id=$2', [
          "admin",
          "rr-e2e-member-other-alpha",
        ]),
      );
    }
    await expectNetworkViolations(violations);
  });

  test("access is a modal dialog with no POST on open, Cancel, or Escape", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    for (const size of [
      { width: 1280, height: 800 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await openAccounts(page, "rr-e2e-personal-viewer");
      const trigger = sourceRow(page, "RR E2E Viewer Primary")
        .getByRole("button", { name: /^Access:/ })
        .first();
      await trigger.click();
      const dialog = dialogFor(page);
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText("RR E2E Org Alpha", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("RR E2E Org Bravo", { exact: true }),
      ).toBeVisible();
      await expect(dialog).not.toContainText(
        /revision|bindingId|rr-e2e-binding|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,
      );
      expect(await bodyScrollLocked(page)).toBe(true);
      await expect.poll(() => activeElementInside(dialog)).toBe(true);
      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press("Tab");
        await expect.poll(() => activeElementInside(dialog)).toBe(true);
      }
      const dialogBox = await dialog.boundingBox();
      const headerBox = await page.locator("header").first().boundingBox();
      expect(dialogBox && headerBox).toBeTruthy();
      if (dialogBox && headerBox) {
        const overlayHit = await page.evaluate(
          ({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return Boolean(
              element &&
              (element.closest('[role="dialog"]') !== null ||
                getComputedStyle(element).position === "fixed"),
            );
          },
          {
            x: headerBox.x + headerBox.width / 2,
            y: headerBox.y + headerBox.height / 2,
          },
        );
        expect(overlayHit).toBe(true);
      }
      await dialog.getByRole("button", { name: /^Close$/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(posts).toEqual([]);
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(posts).toEqual([]);
    await expectNetworkViolations(violations);
  });

  test("removing one organization grant preserves the other scope and source", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-personal-viewer");
    const trigger = sourceRow(page, "RR E2E Viewer Primary")
      .getByRole("button", { name: /^Access:/ })
      .first();
    await trigger.click();
    const dialog = dialogFor(page);
    await expect(dialog).toBeVisible();
    const alphaGrant = dialog
      .getByText("RR E2E Org Alpha", { exact: true })
      .locator("xpath=../..");
    await alphaGrant.getByRole("button", { name: /^Remove access$/ }).click();
    await expect
      .poll(async () =>
        withDatabase(
          process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
          async (db) => {
            const bindings = await db.query(
              'SELECT id, state FROM "WorkspaceAccountBinding" WHERE id = ANY($1::text[]) ORDER BY id',
              [[FIXTURES.bindings.viewerAlpha, FIXTURES.bindings.viewerBravo]],
            );
            const source = await db.query(
              'SELECT state, "ownerUserId", "gatewayAccountRef" FROM "ProviderAccountConnection" WHERE id=$1',
              [FIXTURES.sources.viewerPrimary],
            );
            return { bindings: bindings.rows, source: source.rows[0] };
          },
        ),
      )
      .toEqual({
        bindings: [
          { id: FIXTURES.bindings.viewerAlpha, state: "revoked" },
          { id: FIXTURES.bindings.viewerBravo, state: "active" },
        ],
        source: {
          state: "active",
          ownerUserId: FIXTURES.users.viewer,
          gatewayAccountRef: FIXTURES.gateway.accounts.viewerPrimary,
        },
      });
    await expect(
      dialog.getByText("RR E2E Org Bravo", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("RR E2E Viewer Primary", { exact: true }),
    ).toHaveCount(1);
    await expectNetworkViolations(violations);
  });

  test("direct server action authorization denies foreign workspaces", async ({
    page,
    context,
    request,
  }) => {
    await useViewerSession(context);
    const denied = await context.request.get(
      "/api/dashboard/provider-keys?workspace=rr-e2e-ws-personal-foreign&providerType=mimo",
    );
    expect([401, 403]).toContain(denied.status());
    const signedOut = await request.get(
      "/api/dashboard/provider-keys?workspace=rr-e2e-ws-org-alpha&providerType=mimo",
    );
    expect([401, 403]).toContain(signedOut.status());
    const observedRead = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/dashboard/accounts/access",
    );
    await openAccounts(page, "rr-e2e-personal-viewer");
    const accessUrl = (await observedRead).url();
    const ownRead = await context.request.get(accessUrl);
    expect(ownRead.headers()["cache-control"]).toContain("no-store");
    expect((await ownRead.json()).status).toBe("ok");
    const signedOutAccess = await request.get(accessUrl);
    expect(await signedOutAccess.json()).toEqual({ status: "denied" });
    await context.clearCookies();
    await useOtherSession(context);
    const crossUser = await context.request.get(accessUrl);
    expect(await crossUser.json()).toEqual({ status: "denied" });
  });

  test("sticky browser geometry is coherent at all required viewport and zoom samples", async ({
    browser,
  }, info) => {
    const violations: string[] = [];
    const receipts: unknown[] = [];
    for (const sample of [
      { width: 1280, height: 800, zoom: 1 },
      { width: 1280, height: 360, zoom: 1 },
      { width: 360, height: 800, zoom: 1 },
      { width: 1280, height: 800, zoom: 2 },
    ]) {
      const cssHeight = sample.height / sample.zoom;
      const context = await browser.newContext({
        viewport: { width: sample.width / sample.zoom, height: cssHeight },
        deviceScaleFactor: sample.zoom,
      });
      const page = await context.newPage();
      await installLoopbackOnlyNetworkGuard(page, violations);
      await useViewerSession(context);
      await openAccounts(page, "rr-e2e-org-alpha");
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = "auto";
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-dashboard-layout-ready",
        "true",
      );
      await expect(
        page.getByRole("tablist", { name: "Workspace", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByText("Current workspace", { exact: true }),
      ).toHaveCount(0);
      const geometry = async () =>
        page.evaluate(() => {
          const rect = (selector: string) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error(`missing geometry element ${selector}`);
            const r = el.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              height: r.height,
              position: getComputedStyle(el).position,
            };
          };
          return {
            header: rect("header"),
            bar: rect("#dashboard-workspace-bar"),
            nav: rect("#dashboard-section-sidebar"),
            section: rect("#dashboard-workspace"),
            footer: rect("footer"),
            overflow: document.documentElement.scrollWidth - innerWidth,
            y: scrollY,
          };
        });
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const initial = await geometry();
      const stickyThreshold = Math.ceil(
        initial.bar.top - initial.header.bottom,
      );
      for (const y of [stickyThreshold + 220, stickyThreshold + 400]) {
        await page.evaluate(
          (y) => scrollTo({ top: y, behavior: "instant" }),
          y,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const g = await geometry();
        receipts.push({ sample, requestedY: y, ...g });
        await info.attach(
          `geometry-${sample.width}x${sample.height}-z${sample.zoom}-y${y}`,
          {
            body: Buffer.from(JSON.stringify({ sample, requestedY: y, ...g })),
            contentType: "application/json",
          },
        );
        expect(g.overflow).toBeLessThanOrEqual(1);
        expect(g.header.top).toBeCloseTo(0, 0);
        expect(g.header.position).toBe("sticky");
        if (g.section.bottom > g.nav.bottom + 2) {
          expect(Math.abs(g.bar.top - g.header.bottom)).toBeLessThanOrEqual(2);
          expect(Math.abs(g.nav.top - g.bar.bottom - 8)).toBeLessThanOrEqual(2);
        }
      }
      await info.attach(
        `sticky-view-${sample.width}x${sample.height}-zoom${sample.zoom}`,
        { body: await page.screenshot(), contentType: "image/png" },
      );
      const visibleLinks = page.locator(
        "#dashboard-section-sidebar [role=tab]:visible, #dashboard-section-sidebar nav a:visible",
      );
      const last = visibleLinks.last();
      await last.focus();
      await expect(last).toBeFocused();
      const box = await last.boundingBox();
      expect(box).toBeTruthy();
      if (box) {
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(cssHeight + 1);
      }
      await page.evaluate(() =>
        scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "instant",
        }),
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const end = await geometry();
      receipts.push({ sample, atFooter: true, ...end });
      expect(end.nav.bottom).toBeLessThanOrEqual(end.section.bottom + 2);
      expect(end.bar.bottom).toBeLessThanOrEqual(end.section.bottom + 2);
      expect(end.footer.bottom).toBeLessThanOrEqual(cssHeight + 2);
      await info.attach(
        `viewport-${sample.width}x${sample.height}-zoom${sample.zoom}`,
        { body: await page.screenshot(), contentType: "image/png" },
      );
      await context.close();
    }
    await info.attach("sticky-geometry", {
      body: Buffer.from(JSON.stringify(receipts, null, 2)),
      contentType: "application/json",
    });
    await expectNetworkViolations(violations);
  });

  test("tab, workspace, hash, back, forward, and user switch conceal no heading or cache", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-org-alpha");
    await page.getByRole("tab", { name: /RR E2E Org Bravo/ }).click();
    await expect(
      page.getByText("Connections available for RR E2E Org Bravo.", {
        exact: false,
      }),
    ).toBeVisible();
    // The heading was removed on purpose (UX batch 3); the Accounts region is
    // the page's top anchor and must stay clear of the workspace bar.
    const accountsRegion = page.getByRole("region", { name: "Accounts" });
    await expect(accountsRegion).toBeVisible();
    await page.evaluate(() => {
      location.hash = "dashboard-section-content";
    });
    await expect(accountsRegion).toBeVisible();
    await expect
      .poll(async () => {
        const region = await accountsRegion.boundingBox();
        const bar = await page
          .locator("#dashboard-workspace-bar")
          .boundingBox();
        return region && bar ? region.y - (bar.y + bar.height) : -1;
      })
      .toBeGreaterThanOrEqual(0);
    await page.goBack();
    await expect(
      page.getByText("Connections available for RR E2E Org Bravo.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByText("Connections available for RR E2E Org Alpha.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.goForward();
    await expect(accountsRegion).toBeVisible();
    await context.clearCookies();
    await useOtherSession(context);
    await openAccounts(page, "rr-e2e-personal-other");
    await expect(
      page.getByText("RR E2E Other Person Primary", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("RR E2E Viewer Primary", { exact: true }),
    ).toHaveCount(0);
    await expectNetworkViolations(violations);
  });

  test("legacy disabled and v2 suspended wire action truthfulness", async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    await installLoopbackOnlyNetworkGuard(page, violations);
    await useViewerSession(context);
    await openAccounts(page, "rr-e2e-personal-viewer");
    const legacy = sourceRow(page, "RR E2E Legacy Disabled");
    await legacy.getByRole("button", { name: /Actions for/ }).click();
    // Retired sources intentionally expose no management items; an empty menu
    // need not acquire an accessible role. The forbidden actions stay absent.
    await expect(legacy.getByText("Retired", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("menuitem", {
        name: /Enable|Disable|Reconnect|Update API key|Refresh Codex|Connect Codex/i,
      }),
    ).toHaveCount(0);
    // Disabled is terminal for lifecycle delete (store and DB CAS guard), so
    // no dead removal control. Menu content renders through a portal, so this
    // is page-scoped.
    await expect(
      page.getByRole("menuitem", { name: /Remove connection/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(legacy.getByRole("button", { name: /Enable/i })).toHaveCount(
      0,
    );
    await expect(
      legacy.getByRole("button", { name: /^(Disable|Retire)$/i }),
    ).toHaveCount(0);
    const suspended = sourceRow(page, "RR E2E Suspended Capable");
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST")
        posts.push(new URL(request.url()).pathname);
    });
    const menuTrigger = suspended.getByRole("button", { name: /Actions for/ });
    await menuTrigger.click();
    await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");
    const resume = page.getByRole("menuitem", {
      name: "Enable",
      exact: true,
    });
    await expect(resume).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Disable", exact: true }),
    ).toHaveCount(0);
    await resume.click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toBeVisible();
    const cancel = confirmation.getByRole("button", {
      name: "Cancel",
      exact: true,
    });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(confirmation).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
    expect(posts).toEqual([]);
    await expectNetworkViolations(violations);
  });
});
