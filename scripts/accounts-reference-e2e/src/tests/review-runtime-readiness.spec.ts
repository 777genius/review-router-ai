import { expect, test, type Page } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { expectNoHorizontalOverflow } from "./provider-setup-support.ts";
import {
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_REVIEW_RUNTIME !== "1",
  "Requires --review-runtime-fixture with synthetic registered releases; no live credentials.",
);

const repository = (page: Page, key: string) =>
  page.locator(`[data-repository-row-id="rr-e2e-runtime-${key}"]`);

test.describe("review runtime readiness", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1100 },
    { name: "mobile", width: 390, height: 844 },
  ])
    test(`${viewport.name}: current, same-transport update, unknown and candidate states stay coherent`, async ({
      page,
      context,
    }, info) => {
      const violations: string[] = [];
      await installLoopbackOnlyNetworkGuard(page, violations);
      await useViewerSession(context);
      await page.setViewportSize(viewport);
      await page.goto(
        `/dashboard?section=repositories&workspace=${FIXTURES.workspaces.personalViewer}`,
        { waitUntil: "domcontentloaded", timeout: 120_000 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-dashboard-layout-ready",
        "true",
        { timeout: 60_000 },
      );
      await expect(
        page.getByRole("region", {
          name: "GitHub repository access",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(repository(page, "foreign")).toHaveCount(0);
      await expect(
        page.getByText(FIXTURES.workspaceNames.personalForeign, {
          exact: true,
        }),
      ).toHaveCount(0);

      await expect(
        repository(page, "current").locator("label.setup-toggle"),
      ).toContainText("4/4");
      for (const key of ["update", "unknown", "failed"])
        await expect(
          repository(page, key).locator("label.setup-toggle"),
        ).toContainText("1/4");
      await expect(
        repository(page, "pending").locator("label.setup-toggle"),
      ).toContainText("2/4");

      const update = repository(page, "update");
      await update.locator("label.setup-toggle").click();
      await expect(update.getByRole("status")).toContainText(
        "installed review workflow needs an update",
      );
      await expect(update.getByRole("status")).toContainText(
        "merge it on GitHub",
      );
      await expect(
        update.getByRole("button", { name: "Create update PR", exact: true }),
      ).toBeVisible();
      await expect(
        update.getByRole("button", { name: "Verify setup", exact: true }),
      ).toHaveCount(0);

      const unknown = repository(page, "unknown");
      await unknown.locator("label.setup-toggle").click();
      await expect(unknown.getByRole("status")).toContainText(
        "has not verified this repository",
      );
      await expect(
        unknown.getByRole("button", { name: "Verify setup", exact: true }),
      ).toBeVisible();
      await expect(
        unknown.getByRole("button", { name: "Create update PR", exact: true }),
      ).toHaveCount(0);

      // Existing optimistic events must not turn an unverified caller into Ready.
      // The rows answer the burst with one server refresh and keep the document:
      // a full reload would close the expanded rows and any open dialog.
      const refreshed = page.waitForResponse(
        (response) =>
          response.url().includes("_rsc=") &&
          !response.request().headers()["next-router-prefetch"],
      );
      await page.evaluate(() => {
        Object.assign(window, { reviewRuntimeDocument: true });
        for (const key of ["update", "unknown", "pending"])
          for (const type of [
            "reviewrouter:setup-pull-request-merged",
            "reviewrouter:provider-setup-confirmed",
          ])
            window.dispatchEvent(
              new CustomEvent(type, {
                detail: {
                  repositoryId: `rr-e2e-runtime-${key}`,
                  repositoryFullName: `rr-e2e-viewer/runtime-${key}`,
                  authMode: "openrouter_api_key",
                  providerKind: "openrouter",
                },
              }),
            );
      });
      await refreshed;
      const expectSameDocument = async () =>
        expect(
          await page.evaluate(() => "reviewRuntimeDocument" in window),
        ).toBe(true);
      for (const key of ["update", "unknown", "pending"])
        await expect(
          repository(page, key).locator("label.setup-toggle"),
        ).not.toContainText("4/4");

      await expectNoHorizontalOverflow(page);
      const expandRuntimeDetails = async () => {
        for (const row of [update, unknown]) {
          if (!(await row.getByRole("status").isVisible()))
            await row.locator("label.setup-toggle").click();
          await expect(row.getByRole("status")).toBeVisible();
        }
      };
      await expandRuntimeDetails();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`review-runtime-${viewport.name}-dark.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Dark theme", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expectSameDocument();
      await expandRuntimeDetails();
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`review-runtime-${viewport.name}-light.png`),
        fullPage: true,
      });
      if (viewport.name === "desktop") {
        await page.setViewportSize({ width: 820, height: 1100 });
        await expandRuntimeDetails();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: info.outputPath("review-runtime-intermediate-light.png"),
          fullPage: true,
        });
        await page.setViewportSize(viewport);
      }
      // The Ready filter holds only the verified current repository. It runs
      // last: a later server refresh renders rich rows for this filter only.
      const filters = page.getByRole("group", { name: "Repository filters" });
      await filters.getByRole("button", { name: "Ready", exact: true }).click();
      await expect(page).toHaveURL(/[?&]setup=ready(&|$)/u);
      await expect(repository(page, "current")).toBeVisible();
      for (const key of ["update", "unknown", "failed", "pending"])
        await expect(repository(page, key)).not.toBeVisible();
      await filters.getByRole("button", { name: "All", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "Find repository", exact: true })
        .fill(`${FIXTURES.identities.foreign.login}/runtime-foreign`);
      await expect(page.getByText("No matches", { exact: true })).toBeVisible();
      await expect(repository(page, "current")).not.toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`review-runtime-${viewport.name}-empty.png`),
        fullPage: true,
      });
      await expectSameDocument();
      await expectNetworkViolations(violations);
    });
});
