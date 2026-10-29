// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { GatewayReviewerRoster } from "./gateway-reviewer-roster";
import {
  GatewayModelAccountsProvider,
  type GatewayModelAccountsApi,
} from "../gateway-model-account-options";
import { saveProviderRoster } from "./provider-setup-api";

vi.mock("./provider-setup-api", () => ({ saveProviderRoster: vi.fn() }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const selection = (profileId: string, requiredHealthy = true) => ({
  profileId,
  reasoningEffort: "high" as const,
  agenticContext: true,
  fastMode: false,
  requiredHealthy,
});
const accounts: AccountsResult<AccountsPage> = {
  status: "ok",
  value: {
    nextCursor: null,
    profiles: [
      {
        id: "gateway-profile",
        label: "Account models",
        protocol: "openai-responses",
        models: ["model-one", "model-two"],
        connection: {
          provider: "mimo",
          planLabel: "API",
          regionLabel: "Global",
          completionInputKind: "none",
          personalOnly: false,
          limitsContract: "none",
          modelSettings: ["model-one", "model-two"].map((modelId) => ({
            modelId,
            reasoning: { allowed: ["medium", "high"], default: "high" },
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          })),
        },
      },
    ],
    accounts: [
      {
        connectionId: "connection",
        label: "Team account",
        profileId: "gateway-profile",
        profileLabel: "Models",
        state: "active",
        gatewayRevision: 1,
        mirrorRevision: 1,
        binding: {
          id: "binding",
          state: "active",
          revision: 1,
          fencePending: false,
        },
      },
    ],
  },
};
function view(): ProviderSetupView {
  return {
    workspaceId: "w",
    target: "workspace",
    workspaceVersion: 4,
    execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
    defaultSelection: selection("one", false),
    defaultSelections: [selection("one", false), selection("two")],
    profiles: ["one", "two"].map((id) => ({
      id,
      model: `model-${id}`,
      label: `Profile ${id}`,
      authMode: "codex_account_gateway",
      credentialKind: "gateway_binding",
      gatewayBindingId: "binding",
      gatewayProfileRef: "gateway-profile",
      isDefault: true,
      decision: { allowed: true },
      refusedRepositoryCount: 0,
    })),
    repositories: [
      {
        id: "r",
        fullName: "org/repo",
        source: "repository",
        selection: selection("one"),
        selections: [selection("one"), selection("two")],
        version: 2,
        execution: { providerMaxParallel: 2 },
        useDefault: { allowed: true },
      },
    ],
    sources: [
      {
        key: "gateway_binding",
        authMode: "codex_account_gateway",
        credentialKind: "gateway_binding",
        decision: { allowed: true },
      },
    ],
    viewerIsAdmin: true,
  };
}
const base = () => ({
  workspaceId: "w",
  target: { kind: "workspace" as const },
  view: view(),
  gatewayAccounts: accounts,
  modelOptions: ["model-one", "model-two"].map((value) => ({
    value,
    label: value,
    provider: "codex" as const,
  })),
  agentProfileOptions: [],
  mutationsEnabled: true,
  readUnavailable: false,
  onLockedChange: vi.fn(),
  onSaved: vi.fn(async () => {}),
  onRefresh: vi.fn(async () => view()),
  onChooseOther: vi.fn(),
});
async function choose(label: RegExp, option: RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name: label }));
  const row = await screen.findByRole("option", { name: option });
  fireEvent.mouseMove(row);
  fireEvent.click(row);
}
beforeEach(() => {
  vi.mocked(saveProviderRoster).mockResolvedValue({
    status: "saved",
    results: [],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Gateway reviewer roster", () => {
  it.each(["unavailable", "empty"] as const)(
    "retains model refresh after an %s catalog result while saving stays blocked",
    async (outcome) => {
      if (accounts.status !== "ok") throw new Error("fixture_unavailable");
      const page = accounts.value;
      const detail = (
        models: string[],
      ): Awaited<ReturnType<GatewayModelAccountsApi["get"]>> => ({
        status: "ok",
        value: {
          account: {
            ...page.accounts[0]!,
            modelCatalog: {
              status: "snapshot",
              source: "legacy_profile",
              models,
            },
          },
          profile: { ...page.profiles[0]!, models },
        },
      });
      const get = vi
        .fn<GatewayModelAccountsApi["get"]>()
        .mockResolvedValueOnce(detail(["model-one", "model-two"]))
        .mockResolvedValueOnce(
          outcome === "unavailable" ? { status: "unavailable" } : detail([]),
        )
        .mockResolvedValueOnce(detail(["model-one", "model-two"]));
      render(
        <GatewayModelAccountsProvider
          scope="viewer:workspace:w"
          api={{ get, list: vi.fn<GatewayModelAccountsApi["list"]>() }}
        >
          <GatewayReviewerRoster {...base()} />
        </GatewayModelAccountsProvider>,
      );
      fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
      const refresh = await screen.findByRole("button", {
        name: /^Refresh models$/,
      });
      const save = screen.getByRole("button", { name: "Save reviewers" });
      expect(save).toHaveProperty("disabled", false);
      fireEvent.click(refresh);
      await waitFor(() => expect(save).toHaveProperty("disabled", true));
      const retry = screen.getByRole("button", { name: /^Refresh models$/ });
      await waitFor(() => expect(retry).toHaveProperty("disabled", false));
      expect(screen.getByText(/1\. model-one/)).toBeTruthy();
      expect(screen.getByText(/2\. model-two/)).toBeTruthy();
      const unknownWarning =
        "Model availability could not be checked. Edit this reviewer to refresh account models. Your saved selection is unchanged.";
      const unavailableWarning =
        "This model is unavailable for this account. Edit this reviewer to choose another model.";
      expect(
        screen.getAllByText(
          outcome === "unavailable" ? unknownWarning : unavailableWarning,
        ),
      ).toHaveLength(2);
      expect(
        screen.queryByText(
          outcome === "unavailable" ? unavailableWarning : unknownWarning,
        ),
      ).toBeNull();
      fireEvent.click(save);
      expect(saveProviderRoster).not.toHaveBeenCalled();
      fireEvent.click(retry);
      await waitFor(() => expect(save).toHaveProperty("disabled", false));
      expect(get.mock.calls.slice(1)).toEqual([
        ["binding", { forceRefresh: true }],
        ["binding", { forceRefresh: true }],
      ]);
      fireEvent.click(save);
      await waitFor(() => expect(saveProviderRoster).toHaveBeenCalledTimes(1));
    },
  );

  it("saves the whole observed roster and execution patch while preserving stored health settings", async () => {
    render(<GatewayReviewerRoster {...base()} />);
    await choose(/^Max parallel providers/, /^2$/);
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedWorkspaceVersion: 4,
          executionPatch: { providerMaxParallel: 2 },
          reviewers: [
            {
              provider: { kind: "profile", profileId: "one" },
              settings: expect.objectContaining({ requiredHealthy: false }),
            },
            {
              provider: { kind: "profile", profileId: "two" },
              settings: expect.objectContaining({ requiredHealthy: true }),
            },
          ],
        }),
      ),
    );
    expect(screen.queryByText("Optional")).toBeNull();
  });

  it("removes only the chosen row and keeps the last reviewer", async () => {
    render(<GatewayReviewerRoster {...base()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(screen.queryByText(/1\. model-one/)).toBeNull();
    expect(screen.getByText(/1\. model-two/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewers: [
            {
              provider: { kind: "profile", profileId: "two" },
              settings: expect.any(Object),
            },
          ],
        }),
      ),
    );
  });

  it("retains a stale edited draft through background refetch and only reloads on request", async () => {
    const props = base();
    const rendered = render(<GatewayReviewerRoster {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    await choose(/^Review depth/, /^Medium/);
    const latest = {
      ...view(),
      workspaceVersion: 5,
      defaultSelections: [selection("one")],
    };
    rendered.rerender(<GatewayReviewerRoster {...props} view={latest} />);
    vi.mocked(saveProviderRoster).mockResolvedValueOnce({
      status: "error",
      error: "dashboard_action_stale",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await screen.findByRole("alert");
    expect(screen.getByText(/2\. model-two/)).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
    ).toContain("Medium");
    expect(
      screen.getByRole("button", { name: "Save reviewers" }),
    ).toHaveProperty("disabled", true);
    expect(saveProviderRoster).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(saveProviderRoster).mock.calls[0]![0].expectedWorkspaceVersion,
    ).toBe(4);
  });

  it("restores the complete workspace roster with both observed versions", async () => {
    const props = base();
    render(
      <GatewayReviewerRoster
        {...props}
        target={{
          kind: "repository",
          repository: {
            id: "r",
            fullName: "org/repo",
            visibility: "private",
            canManageCredentials: true,
            effective: {
              authMode: "codex_account_gateway",
              credentialKind: "gateway_binding",
            },
            secretGuidance: null,
            organizationLogin: null,
            organizationSecretPolicy: null,
            rotatingEnabled: false,
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use workspace reviewers" }),
    );
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith({
        workspaceId: "w",
        expectedWorkspaceVersion: 4,
        target: {
          kind: "repositories",
          repositories: [{ repositoryId: "r", expectedVersion: 2 }],
        },
        reviewers: null,
      }),
    );
  });

  it("adds a new independently configured reviewer without raising parallelism", async () => {
    const props = base();
    props.view = { ...props.view, defaultSelections: [selection("one")] };
    render(<GatewayReviewerRoster {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    await choose(/^Account for reviewer 2/, /^Team account/);
    await choose(/^Model$/, /^model-two$/);
    await choose(/^Review depth/, /^Medium/);
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewers: [
            {
              provider: { kind: "profile", profileId: "one" },
              settings: expect.any(Object),
            },
            {
              provider: {
                kind: "new",
                credential: {
                  kind: "gateway_binding",
                  bindingId: "binding",
                  gatewayProfileRef: "gateway-profile",
                },
                model: "model-two",
              },
              settings: expect.objectContaining({
                reasoningEffort: "medium",
                requiredHealthy: true,
              }),
            },
          ],
        }),
      ),
    );
    expect(vi.mocked(saveProviderRoster).mock.calls[0]![0]).not.toHaveProperty(
      "executionPatch",
    );
  });
});
