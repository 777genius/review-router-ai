// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./memory-settings-actions", () => ({
  saveWorkspaceMemorySettingsClientAction: vi.fn(),
}));
import { MemorySettings } from "./memory-settings";
afterEach(cleanup);

describe("Memory workspace settings", () => {
  it("starts automatic and submits only the workspace setting and captured version", () => {
    const { container } = render(
      <MemorySettings
        workspaceId="workspace-selected"
        requireConfirmation={false}
        version={7}
        canEdit
        mutationsEnabled
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /Require confirmation/,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const data = new FormData(container.querySelector("form")!);
    expect([...data.entries()]).toEqual([
      ["workspaceId", "workspace-selected"],
      ["expectedVersion", "7"],
    ]);
    checkbox.click();
    expect(
      new FormData(container.querySelector("form")!).get("requireConfirmation"),
    ).toBe("on");
    expect(screen.getByText(/every repository in this workspace/)).toBeTruthy();
  });
  it("shows the persisted setting read-only to a non-admin", () => {
    render(
      <MemorySettings
        workspaceId="workspace-selected"
        requireConfirmation
        version={7}
        canEdit={false}
        mutationsEnabled
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /Require confirmation/,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Save memory settings" }),
    ).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Only workspace owners and admins",
    );
  });
});
