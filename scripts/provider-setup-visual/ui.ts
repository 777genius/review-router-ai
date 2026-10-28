/**
 * Routes and locators of the provider setup screens, shared by the screenshot
 * scenarios and the end-to-end flows. They follow the shipped roles and
 * labels, so a copy change that breaks one fails loudly in both.
 */
import type { Locator, Page } from "playwright-core";
import { dashboardPath } from "../../apps/web/app/dashboard/dashboard-section.js";
import {
  VISUAL_REPOSITORIES,
  VISUAL_WORKSPACES,
  visualRepositoryFullName,
  type VisualRepositoryKey,
  type VisualWorkspaceKey,
} from "./fixture-contract.js";

export function workspaceRoute(
  workspace: VisualWorkspaceKey,
  section: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return dashboardPath({
    section,
    workspace: VISUAL_WORKSPACES[workspace].slug,
    ...extra,
  });
}

/** The repositories section with one repository's setup steps opened. */
export function repositoryRoute(key: VisualRepositoryKey): string {
  const repository = VISUAL_REPOSITORIES[key];
  return workspaceRoute(repository.workspace, "repositories", {
    workspace: VISUAL_WORKSPACES[repository.workspace].id,
    repository: visualRepositoryFullName(repository),
  });
}

export function repositoryRow(page: Page, key: VisualRepositoryKey): Locator {
  return page.locator(
    `[data-repository-row-id="${VISUAL_REPOSITORIES[key].id}"]`,
  );
}

/** The row header: name, badges and the compact provider line. */
export function repositoryRowHeader(
  page: Page,
  key: VisualRepositoryKey,
): Locator {
  return repositoryRow(page, key).locator(".repository-setup-row-header");
}

/** The opened setup panel: provider line and the four steps. */
export function repositorySetupPanel(
  page: Page,
  key: VisualRepositoryKey,
): Locator {
  return repositoryRow(page, key).locator("[data-repository-setup-panel]");
}

/** The step pill of a row ("SETUP 3/4"); its title names the step. */
export async function repositoryStepPill(
  page: Page,
  key: VisualRepositoryKey,
): Promise<Locator> {
  const row = repositoryRow(page, key);
  const disclosure = await row.getAttribute("data-disclosure-id");
  return row.locator(`label[for="${disclosure ?? ""}"]`).first();
}

export const PROVIDER_DIALOG_LOADING = "Loading providers...";

/**
 * Clicks a trigger of the provider dialog (or any dialog) and returns the
 * opened dialog once its server view loaded.
 */
export async function openDialog(
  page: Page,
  trigger: Locator,
): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  await trigger.scrollIntoViewIfNeeded();
  // A click before hydration is lost; try again a few times.
  for (let attempt = 1; ; attempt += 1) {
    await trigger.click();
    try {
      await dialog.waitFor({ state: "visible", timeout: 5_000 });
      break;
    } catch (error) {
      if (await dialog.isVisible()) break;
      if (attempt === 4) throw error;
    }
  }
  await dialog
    .getByText(PROVIDER_DIALOG_LOADING)
    .waitFor({ state: "hidden", timeout: 60_000 });
  return dialog;
}

/** Selects a radio card of the dialog by its visible title. */
export async function chooseCard(
  dialog: Locator,
  title: string | RegExp,
): Promise<void> {
  await dialog
    .locator("label")
    .filter({ has: dialog.page().getByRole("radio") })
    .filter({ hasText: title })
    .first()
    .click();
}

/**
 * Picks "Add a new provider"; a dialog with no provider to choose from opens
 * on the new provider form directly.
 */
export async function chooseNewProvider(dialog: Locator): Promise<void> {
  if (
    (await dialog
      .getByRole("heading", { name: "Add the first provider" })
      .count()) > 0
  )
    return;
  await chooseCard(dialog, "Add a new provider");
}

/** The trigger of a labelled select field inside a container. */
export function selectField(container: Locator, label: string): Locator {
  return container
    .locator("label")
    .filter({ hasText: label })
    .getByRole("combobox")
    .first();
}

export const CREDENTIAL_SOURCE_LABEL = "Provider";

/** Opens the credential source list of a new provider. */
export async function openSourceList(
  page: Page,
  dialog: Locator,
): Promise<Locator> {
  await dialog
    .getByRole("combobox", { name: CREDENTIAL_SOURCE_LABEL, exact: true })
    .click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor({ state: "visible" });
  return listbox;
}

export async function chooseSource(
  page: Page,
  dialog: Locator,
  title: RegExp,
): Promise<void> {
  const listbox = await openSourceList(page, dialog);
  await listbox.getByRole("option", { name: title }).first().click();
  await listbox.waitFor({ state: "hidden" });
}

/** Source titles as `sourceTitle` renders them. */
export const SOURCE = {
  claudeSecret: /^Claude Code · GitHub Secrets/,
  mimoSecret: /^MiMo Token Plan/,
  openRouterKey: /^OpenRouter/,
  mimoKey: /^MiMo Token Plan/,
  rotating: /^Codex · GitHub Secrets/,
} as const;

/** One row of the Providers list by its name. */
export function providerListRow(page: Page, label: string): Locator {
  return page
    .getByRole("region", { name: "Workspace providers" })
    .getByRole("listitem")
    .filter({ hasText: label })
    .first();
}

/** Scrolls an element of a scrolling dialog into view before a screenshot. */
export async function reveal(locator: Locator): Promise<void> {
  await locator.first().scrollIntoViewIfNeeded();
}

/**
 * Types a model as a user does and closes the suggestions, which would cover
 * the buttons below: picks the listed model, or leaves the field for one
 * that is not listed.
 */
export async function chooseModel(
  container: Locator,
  model: string,
): Promise<void> {
  await container.getByRole("textbox", { name: "Model" }).fill(model);
  const listed = container.getByRole("option").filter({
    has: container.page().getByText(model, { exact: true }),
  });
  if ((await listed.count()) > 0) await listed.first().click();
  else await container.getByRole("heading").first().click();
}
