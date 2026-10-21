// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./other-settings-actions", () => ({
  saveWorkspaceOtherSettingsClientAction: vi.fn(),
}));
import { WorkspaceOtherSettings } from "./workspace-other-settings";
afterEach(cleanup);

describe("Other workspace review settings", () => {
  it("shows enabled drafts and carries the selected workspace in the form", () => {
    const { container } = render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests
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

  it("disables the setting and save for a non-admin", () => {
    render(
      <WorkspaceOtherSettings
        workspaceId="workspace-selected"
        reviewDraftPullRequests={false}
        canEdit={false}
      />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save settings",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
