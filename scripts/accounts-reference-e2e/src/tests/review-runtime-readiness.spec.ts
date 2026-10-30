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
      await expect(update.getByRole("status")).toHaveText(
        "Update setup to use the current review runtime.",
      );
      await expect(
        update.getByRole("button", { name: "Update setup PR", exact: true }),
      ).toBeVisible();
      await expect(
        update.getByRole("button", { name: "Verify setup", exact: true }),
      ).toHaveCount(0);

      const unknown = repository(page, "unknown");
      await unknown.locator("label.setup-toggle").click();
      await expect(unknown.getByRole("status")).toHaveText(
        "Review runtime support is not confirmed yet. Verify setup before the next review.",
      );
      await expect(
        unknown.getByRole("button", { name: "Verify setup", exact: true }),
      ).toBeVisible();
      await expect(
        unknown.getByRole("button", { name: "Update setup PR", exact: true }),
      ).toHaveCount(0);

      // Existing optimistic events must not turn an unverified caller into Ready.
      await page.evaluate(() => {
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
      for (const key of ["update", "unknown", "pending"])
        await expect(
          repository(page, key).locator("label.setup-toggle"),
        ).not.toContainText("4/4");

      const response = await context.request.get(
        `/api/dashboard/repositories/search?workspace=${FIXTURES.workspaces.personalViewer}&setup=ready`,
      );
      expect(response.ok()).toBe(true);
      expect((await response.json()).repositoryIds).toEqual([
        "rr-e2e-runtime-current",
      ]);

      await expectNoHorizontalOverflow(page);
      // Provider confirmations can refresh the document. The layout read above
      // may recover against fresh server HTML before its controls are hydrated.
      // Await the real dashboard readiness signal before the single theme click.
      await expect(page.locator("html")).toHaveAttribute(
        "data-dashboard-layout-ready",
        "true",
        { timeout: 60_000 },
      );
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
      await expandRuntimeDetails();
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`review-runtime-${viewport.name}-light.png`),
        fullPage: true,
      });
      await page
        .getByRole("searchbox", { name: "Find repository", exact: true })
        .fill("fixture-no-matching-repository");
      await expect(page.getByText("No matches", { exact: true })).toBeVisible();
      await expect(repository(page, "current")).not.toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`review-runtime-${viewport.name}-empty.png`),
        fullPage: true,
      });
      await expectNetworkViolations(violations);
    });
});
