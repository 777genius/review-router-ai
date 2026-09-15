// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedPoolSettingsPanel } from "./hosted-pool-settings";
import type { HostedPoolDashboardView } from "../../src/server/hosted-pool-dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const action = vi.fn(async () => ({ params: {} }));

const actions = {
  importAccount: action,
  startDeviceLogin: async () => ({
    ok: false as const,
    params: { error: "hosted_pool_action_failed" },
  }),
  pollDeviceLogin: async () => ({
    ok: false as const,
    params: { error: "hosted_pool_action_failed" },
  }),
  setAccountState: action,
  setRepositorySource: action,
};

function expectNoCredentialLeak(): void {
  expect(document.body.textContent).not.toMatch(
    /token|fingerprint|credentialRef/iu,
  );
}

function renderPanel(view: HostedPoolDashboardView) {
  return render(
    <HostedPoolSettingsPanel
      workspaceId="workspace-1"
      mutationsEnabled
      actions={actions}
      view={view}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("HostedPoolSettingsPanel", () => {
  it("keeps ChatGPT as the empty-state hero and hides auth.json behind a fallback", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [],
      repositories: [],
    });

    expect(screen.getByText("Sign in with ChatGPT")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeTruthy();
    expect(screen.queryByText("Add another ChatGPT account")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Enrolled accounts" }),
    ).toBeNull();
    expect(screen.getByText(/No hosted accounts yet/)).toBeTruthy();
    expect(screen.getByText("Upload auth.json fallback")).toBeTruthy();
    expect(screen.getByPlaceholderText("Fallback session")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Primary")).toBeTruthy();
    expect(
      screen.getAllByText(/never go to the browser/i).length,
    ).toBeGreaterThan(0);
    expectNoCredentialLeak();
  });

  it("puts enrolled accounts first and de-emphasizes the empty start form", () => {
    renderPanel({
      gate: "enabled",
      pool: {
        id: "pool-1" as never,
        workspaceId: "workspace-1" as never,
        status: "active",
        isDefault: true,
        revision: 1,
        accountCount: 1,
        healthyAccountCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      accounts: [
        {
          id: "account-1" as never,
          label: "Primary",
          priority: 10,
          availability: { status: "healthy" },
          authGeneration: 2,
          healthVersion: 1,
          validatedAt: new Date(),
          credentialExpiresAt: null,
          refreshDue: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      repositories: [],
    });

    expect(
      screen.getByRole("heading", { name: "Enrolled accounts" }),
    ).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText(/Priority 10/)).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByText("Add another ChatGPT account")).toBeTruthy();
    expect(screen.queryByText(/No hosted accounts yet/)).toBeNull();
    expect(screen.getByPlaceholderText("Fallback session")).toBeTruthy();
    expect(
      screen.getAllByText(/Credentials stay on the server/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/never go to the browser/i).length,
    ).toBeGreaterThan(0);
    expectNoCredentialLeak();
  });

  it("shows safe labels and state without rendering credential metadata", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [
        {
          id: "account-1" as never,
          label: "Primary",
          priority: 10,
          availability: { status: "healthy" },
          authGeneration: 2,
          healthVersion: 1,
          validatedAt: new Date(),
          credentialExpiresAt: null,
          refreshDue: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      repositories: [],
    });
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText(/Priority 10/)).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("keeps the custody UI absent when the feature gate is off", () => {
    const { container } = renderPanel({
      gate: "feature_disabled",
      pool: null,
      accounts: [],
      repositories: [],
    });
    expect(container.innerHTML).toBe("");
  });
});
