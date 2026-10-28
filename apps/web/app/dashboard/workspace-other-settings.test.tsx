// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./other-settings-actions", () => ({
  saveWorkspaceOtherSettingsClientAction: vi.fn(),
  saveWorkspaceAccessRightsClientAction: vi.fn(),
}));
import { WorkspaceOtherSettings } from "./workspace-other-settings";
afterEach(cleanup);

describe("Other workspace review settings", () => {
  it("shows enabled drafts and carries the selected workspace in the form", () => {
    const { container } = render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests
        providerManagementAdminOnly={false}
        canEdit
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /Review draft pull requests/,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    const form = container.querySelector("form")!;
    expect(new FormData(form).get("workspaceId")).toBe("workspace-selected");
    checkbox.click();
    expect(new FormData(form).get("reviewDraftPullRequests")).toBeNull();
  });

  it("shows a non-admin the settings disabled, without a save button", () => {
    render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests={false}
        providerManagementAdminOnly={false}
        canEdit={false}
      />,
    );
    for (const checkbox of screen.getAllByRole("checkbox"))
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });
});

describe("Other -> Access rights", () => {
  it("lets an owner or admin turn on admin-only provider management in its own form", () => {
    render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests
        providerManagementAdminOnly={false}
        canEdit
      />,
    );
    const section = screen.getByRole("region", { name: "Access rights" });
    const toggle = within(section).getByRole("checkbox", {
      name: /Only owners and admins manage providers/,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    const form = section.querySelector("form")!;
    toggle.click();
    // Only its own field and the workspace: a stale draft value never rides along.
    expect([...new FormData(form).keys()].sort()).toEqual([
      "providerManagementAdminOnly",
      "workspaceId",
    ]);
    expect(
      (
        within(section).getByRole("button", {
          name: "Save access rights",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows members the setting as it is, disabled, with the reason", () => {
    render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests={false}
        providerManagementAdminOnly
        canEdit={false}
      />,
    );
    const section = screen.getByRole("region", { name: "Access rights" });
    const toggle = within(section).getByRole("checkbox", {
      name: /Only owners and admins manage providers/,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
    // The reason is stated once for every setting of the page.
    expect(
      screen.getAllByText(
        "Only workspace owners and admins can change these settings.",
      ),
    ).toHaveLength(1);
    expect(
      within(section).queryByRole("button", { name: "Save access rights" }),
    ).toBeNull();
  });
});
