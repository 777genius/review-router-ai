import assert from "node:assert/strict";
import { VISUAL_WORKSPACES } from "./fixture-contract.ts";
import type { VisualScenario } from "./scenarios.ts";
import { workspaceRoute } from "./ui.ts";

/** Exercise the extracted card through the real authenticated dashboard. */
export const ORG_RULESET_SCENARIOS: readonly VisualScenario[] = [
  {
    id: "org-ruleset-settings",
    title: "Organization ruleset scope, enforcement, and repository fallback",
    users: ["owner"],
    route: workspaceRoute("main", "repositories"),
    widths: [390, 900, 1440],
    prepare: async ({ page }) => {
      const card = page.locator("details").filter({
        has: page
          .locator("summary")
          .filter({ hasText: "Advanced org-wide mode" }),
      });
      await card.locator("summary").focus();
      await page.keyboard.press("Enter");
      const scope = card.getByRole("combobox", { name: "Repository scope" });
      await scope.waitFor({ state: "visible" });
      assert.equal(
        await card.locator('input[name="workspaceId"]').inputValue(),
        VISUAL_WORKSPACES.main.id,
      );
      assert.equal(
        await card.locator('input[name="githubInstallationId"]').inputValue(),
        VISUAL_WORKSPACES.main.installation.githubInstallationId,
      );
      await scope.click();
      await page
        .getByRole("option", { name: "All organization repos", exact: true })
        .click();
      assert.equal(
        await card.locator('input[name="scope"]').inputValue(),
        "all_repositories",
      );
      await scope.click();
      await page
        .getByRole("option", { name: "Selected App repos", exact: true })
        .click();
      await card.getByRole("combobox", { name: "Ruleset enforcement" }).click();
      await page.getByRole("option", { name: "Active", exact: true }).click();
      assert.equal(
        await card.locator('input[name="enforcement"]').inputValue(),
        "active",
      );
      await card.getByRole("combobox", { name: "Ruleset enforcement" }).click();
      await page
        .getByRole("option", { name: "Evaluate first", exact: true })
        .click();
      assert.equal(
        await card.getByRole("button", { name: "Enable org-wide" }).isEnabled(),
        true,
      );
      const fallback = card.getByRole("link", {
        name: "Use setup PR fallback",
      });
      const target = new URL(
        (await fallback.getAttribute("href"))!,
        page.url(),
      );
      assert.equal(target.origin, new URL(page.url()).origin);
      assert.equal(target.pathname, "/dashboard");
      assert.equal(target.searchParams.get("section"), "repositories");
      assert.equal(
        target.searchParams.get("workspace"),
        VISUAL_WORKSPACES.main.installation.accountLogin,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await card.scrollIntoViewIfNeeded();
    },
  },
];
