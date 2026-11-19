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
const repositoryTarget = {
  kind: "repository" as const,
  repository: {
    id: "r",
    fullName: "org/repo",
    visibility: "private" as const,
    canManageCredentials: true,
    effective: {
      authMode: "codex_account_gateway" as const,
      credentialKind: "gateway_binding" as const,
    },
    secretGuidance: null,
    organizationLogin: null,
    organizationSecretPolicy: null,
    rotatingEnabled: false,
  },
};
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
      // A failed read offers Try again; an empty list keeps its small refresh.
      const retry = screen.getByRole("button", {
        name: outcome === "unavailable" ? "Try again" : /^Refresh models$/,
      });
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

  it("reorders parallel reviewers to change the primary", async () => {
    render(<GatewayReviewerRoster {...base()} />);
    fireEvent.click(screen.getByRole("button", { name: "Move reviewer 2 up" }));
    expect(screen.getByText(/1\. model-two/)).toBeTruthy();
    expect(screen.queryByText("Fallback")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          providerMode: "parallel",
          reviewers: [
            expect.objectContaining({
              provider: { kind: "profile", profileId: "two" },
            }),
            expect.objectContaining({
              provider: { kind: "profile", profileId: "one" },
            }),
          ],
        }),
      ),
    );
  });

  it("orders fallback reviewers and saves the mode with the roster", async () => {
    render(<GatewayReviewerRoster {...base()} />);
    await choose(/^How reviewers work together/, /^Fallback in order/);
    expect(
      screen.queryByRole("combobox", { name: /^Max parallel providers/ }),
    ).toBeNull();
    expect(screen.getByText(/^Reviewers run one at a time/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move reviewer 1 up" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Move reviewer 2 up" }));
    expect(screen.getByText(/1\. model-two/)).toBeTruthy();
    expect(screen.getByText("Fallback")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          providerMode: "fallback",
          reviewers: [
            expect.objectContaining({
              provider: { kind: "profile", profileId: "two" },
            }),
            expect.objectContaining({
              provider: { kind: "profile", profileId: "one" },
            }),
          ],
        }),
      ),
    );
  });

  it("explains an inheriting repository and copies the workspace roster with its mode", async () => {
    const props = base();
    const inherited = view();
    render(
      <GatewayReviewerRoster
        {...props}
        view={{
          ...inherited,
          providerMode: "fallback",
          repositories: inherited.repositories.map((row) => ({
            ...row,
            source: "workspace" as const,
            selection: null,
            selections: [],
            execution: {},
          })),
        }}
        target={repositoryTarget}
      />,
    );
    expect(
      screen.getByText(/^This repository uses the workspace default reviewers/),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /^How reviewers work together/ })
        .textContent,
    ).toContain("Fallback in order");
    expect(
      screen.getByRole("button", { name: "Move reviewer 2 up" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Use workspace reviewers" }),
    ).toBeNull();
    // Saving unchanged reviewers is allowed: it pins the current list here.
    fireEvent.click(
      screen.getByRole("button", { name: "Save for this repository" }),
    );
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({
          providerMode: "fallback",
          reviewers: [
            expect.objectContaining({
              provider: { kind: "profile", profileId: "one" },
            }),
            expect.objectContaining({
              provider: { kind: "profile", profileId: "two" },
            }),
          ],
        }),
      ),
    );
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

  it("shows the parallel controls only while there are several reviewers", async () => {
    render(<GatewayReviewerRoster {...base()} />);
    const controls = () =>
      ["How reviewers work together", "Max parallel providers"].map((name) =>
        screen.queryByRole("combobox", { name: new RegExp(`^${name}`) }),
      );
    expect(controls().every(Boolean)).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(controls().some(Boolean)).toBe(false);
    expect(screen.queryByRole("button", { name: /Move reviewer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    expect(controls().every(Boolean)).toBe(true);
  });

  it("hides the controls for several reviewers while one is left and keeps its saved mode", async () => {
    const props = base();
    props.view = {
      ...props.view,
      providerMode: "fallback",
      defaultSelections: [selection("one")],
    };
    render(<GatewayReviewerRoster {...props} />);
    expect(
      screen.queryByRole("combobox", { name: /^How reviewers work together/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /^Max parallel providers/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Move reviewer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    await waitFor(() =>
      expect(saveProviderRoster).toHaveBeenCalledWith(
        expect.objectContaining({ providerMode: "fallback" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    expect(
      screen.getByRole("combobox", { name: /^How reviewers work together/ })
        .textContent,
    ).toContain("Fallback in order");
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
    props.view = {
      ...props.view,
      defaultSelections: [selection("one"), selection("missing")],
    };
    render(<GatewayReviewerRoster {...props} target={repositoryTarget} />);
    expect(
      screen
        .getByRole("button", { name: "Use workspace reviewers" })
        .getAttribute("aria-describedby"),
    ).toBe(
      screen.getByText(
        "Workspace default: Profile one · model-one; Reviewer unavailable.",
      ).id,
    );
    expect(screen.getByRole("button", { name: "Save reviewers" })).toBeTruthy();
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

  it("warns that going back stops reviews while the workspace has no default", () => {
    const props = base();
    props.view = {
      ...props.view,
      defaultSelection: null,
      defaultSelections: [],
    };
    render(<GatewayReviewerRoster {...props} target={repositoryTarget} />);
    expect(
      screen.getByText(
        "Choosing Use workspace reviewers stops reviews here: the workspace has no default reviewers.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Use workspace reviewers" }),
    ).toHaveProperty("disabled", false);
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

  it("does not save a new reviewer whose typed model the picker marks unusable", async () => {
    if (accounts.status !== "ok") throw new Error("fixture_unavailable");
    const profile = accounts.value.profiles[0]!;
    const props = base();
    props.view = { ...props.view, defaultSelections: [selection("one")] };
    // An NVIDIA account without its own fresh catalogue: every model is listed
    // but unusable and the list says why once, so typing its exact name must
    // not make it savable.
    props.gatewayAccounts = {
      status: "ok",
      value: {
        ...accounts.value,
        profiles: [
          {
            ...profile,
            connection: { ...profile.connection!, provider: "nvidia" },
          },
        ],
      },
    };
    render(<GatewayReviewerRoster {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    await choose(/^Account for reviewer 2/, /^Team account/);
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "model-two" },
    });
    expect(
      screen.getByText("Could not update the model list for this account."),
    ).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save reviewers" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(saveProviderRoster).not.toHaveBeenCalled();
  });

  it("names an unavailable account with Try again and has no Refresh accounts button", async () => {
    if (accounts.status !== "ok") throw new Error("fixture_unavailable");
    const get = vi
      .fn<GatewayModelAccountsApi["get"]>()
      .mockResolvedValue({ status: "denied" });
    const list = vi.fn<GatewayModelAccountsApi["list"]>();
    render(
      <GatewayModelAccountsProvider
        scope="viewer:workspace:w"
        api={{ get, list }}
      >
        <GatewayReviewerRoster {...base()} />
      </GatewayModelAccountsProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(
      await screen.findByText(
        "This account is unavailable. Choose another account.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh accounts" })).toBeNull();
    const reads = get.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    await waitFor(() => expect(get.mock.calls.length).toBe(reads + 1));
  });
});
