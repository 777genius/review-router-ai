// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function account(
  overrides: Partial<HostedPoolDashboardView["accounts"][number]> &
    Pick<HostedPoolDashboardView["accounts"][number], "id" | "label">,
): HostedPoolDashboardView["accounts"][number] {
  return {
    priority: 10,
    availability: { status: "healthy" },
    authGeneration: 2,
    healthVersion: 1,
    validatedAt: new Date("2026-09-14T12:00:00.000Z"),
    credentialExpiresAt: null,
    refreshDue: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    ...overrides,
  };
}

function renderPanel(view: HostedPoolDashboardView, mutationsEnabled = true) {
  return render(
    <HostedPoolSettingsPanel
      workspaceId="workspace-1"
      mutationsEnabled={mutationsEnabled}
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
      accounts: [account({ id: "account-1" as never, label: "Primary" })],
      repositories: [],
    });

    expect(
      screen.getByRole("heading", { name: "Enrolled accounts" }),
    ).toBeTruthy();
    expect(screen.getByText("ChatGPT session")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText("Highest priority")).toBeTruthy();
    expect(screen.getByText(/Priority 10/)).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText(/Last validated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Primary")).toBeNull();
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

  it("opens the ChatGPT add panel from the enrolled list header", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [account({ id: "account-1" as never, label: "Primary" })],
      repositories: [],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    );
    expect(screen.getByText("Sign in with ChatGPT")).toBeTruthy();
    expect(screen.getByPlaceholderText("Primary")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("marks the highest-priority account and keeps backup cards secondary", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [
        account({
          id: "account-backup" as never,
          label: "Backup",
          priority: 20,
        }),
        account({
          id: "account-primary" as never,
          label: "Primary",
          priority: 10,
        }),
      ],
      repositories: [],
    });

    expect(screen.getByText("Highest priority")).toBeTruthy();
    expect(screen.getByText("Backup")).toBeTruthy();
    expect(screen.getByText(/Priority 20/)).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("surfaces refresh-due and session expiry without credential metadata", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [
        account({
          id: "account-1" as never,
          label: "Primary",
          refreshDue: true,
          credentialExpiresAt: new Date("2026-12-01T15:30:00.000Z"),
        }),
      ],
      repositories: [],
    });

    expect(screen.getByText(/Session needs attention/)).toBeTruthy();
    expect(
      screen.getByText(/Refresh is due for this ChatGPT session/),
    ).toBeTruthy();
    expect(screen.getByText(/Session expires/)).toBeTruthy();
    expect(screen.getByText(/Dec 1, 2026/)).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("shows a human reason for quarantined sessions", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [
        account({
          id: "account-1" as never,
          label: "Expired session",
          availability: { status: "quarantined", reason: "real_401" },
        }),
      ],
      repositories: [],
    });

    expect(screen.getByText("Needs reconnect")).toBeTruthy();
    expect(screen.getByText(/ChatGPT rejected this session/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expectNoCredentialLeak();
  });

  it("disables pause and add when mutations are off", () => {
    renderPanel(
      {
        gate: "enabled",
        pool: null,
        accounts: [account({ id: "account-1" as never, label: "Primary" })],
        repositories: [],
      },
      false,
    );

    expect(
      (screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Add another ChatGPT account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expectNoCredentialLeak();
  });

  it("shows safe labels and state without rendering credential metadata", () => {
    renderPanel({
      gate: "enabled",
      pool: null,
      accounts: [account({ id: "account-1" as never, label: "Primary" })],
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
