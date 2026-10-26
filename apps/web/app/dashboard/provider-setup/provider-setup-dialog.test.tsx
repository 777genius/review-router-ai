// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import {
  inheritWorkspaceDefaultProviderAction,
  saveProviderSetupAction,
} from "../provider-setup-actions";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";
import {
  apiKeyProviders,
  type ProviderModelCatalogSnapshot,
} from "@reviewrouter/features-review-providers";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { ProviderModelCatalogProvider } from "../provider-model-catalog";
import { BulkProviderSetupAction } from "./repository-selection";
import {
  RepositorySelectionCheckbox,
  RepositorySelectionProvider,
} from "../repository-action-selection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(async () => ({
    status: "missing",
  })),
}));
vi.mock("../provider-setup-actions", () => ({
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderSetupAction: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const selection = (profileId: string) => ({
  profileId,
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
});
const claudeProfile = (id: string, label: string, isDefault = false) => ({
  id,
  label,
  model: "opus",
  authMode: "claude_code_oauth" as const,
  credentialKind: "user_ci_secret" as const,
  gatewayBindingId: null,
  isDefault,
  decision: { allowed: true as const },
  refusedRepositoryCount: 0,
});

let view: ProviderSetupView;

beforeEach(() => {
  view = {
    workspaceId: "workspace_1",
    target: "repositories",
    repositories: [
      {
        id: "repo_1",
        fullName: "acme/widget",
        source: "workspace",
        selection: null,
        useDefault: { allowed: true },
      },
    ],
    defaultSelection: selection("profile_default"),
    profiles: [
      claudeProfile("profile_default", "Team Claude", true),
      claudeProfile("profile_other", "Second Claude"),
    ],
    sources: [],
    viewerIsAdmin: true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => view }) as Response),
  );
  vi.mocked(saveProviderSetupAction).mockResolvedValue({
    status: "saved",
    results: [
      {
        repositoryId: "repo_1",
        fullName: "acme/widget",
        status: "applied",
      },
    ],
  });
  vi.mocked(inheritWorkspaceDefaultProviderAction).mockResolvedValue({
    status: "saved",
    results: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

const repositoryTarget: ProviderSetupDialogProps["target"] = {
  kind: "repository",
  repository: {
    id: "repo_1",
    fullName: "acme/widget",
    visibility: "private",
    canManageCredentials: true,
    effective: {
      authMode: "claude_code_oauth",
      credentialKind: "user_ci_secret",
    },
    secretGuidance: null,
    organizationLogin: null,
    organizationSecretPolicy: null,
    rotatingEnabled: false,
    rotatingPreparationOnly: false,
  },
};

function renderDialog(
  target: ProviderSetupDialogProps["target"],
  props: Partial<ProviderSetupDialogProps> = {},
  catalog?: {
    snapshots: readonly ProviderModelCatalogSnapshot[];
    api: NonNullable<
      import("react").ComponentProps<typeof ProviderModelCatalogProvider>["api"]
    >;
  },
) {
  const content = (
    <ProviderSetupDialog
      workspaceId="workspace_1"
      target={target}
      triggerLabel="Change provider"
      mutationsEnabled
      modelOptions={[]}
      gatewayAccounts={{
        status: "ok",
        value: { accounts: [], profiles: [], nextCursor: null },
      }}
      agentProfileOptions={[]}
      {...props}
    />
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      {catalog ? (
        <ProviderModelCatalogProvider
          snapshots={catalog.snapshots}
          api={catalog.api}
        >
          {content}
        </ProviderModelCatalogProvider>
      ) : (
        content
      )}
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
}

/** Selects the provider option whose row shows the text. */
async function choose(text: string | RegExp): Promise<void> {
  const label = (await screen.findByText(text)).closest("label")!;
  fireEvent.click(label.querySelector('[role="radio"]')!);
}

function apiSources(): ProviderSetupView["sources"] {
  return [
    {
      key: "gateway_binding",
      credentialKind: "gateway_binding",
      authMode: "codex_account_gateway",
      decision: { allowed: true },
    },
    ...apiKeyProviders.map((provider) => ({
      key: `user_ci_secret:${provider.directAuthMode}` as const,
      credentialKind: "user_ci_secret" as const,
      authMode: provider.directAuthMode,
      decision: { allowed: true as const },
    })),
  ];
}

async function chooseSelect(label: string, name: string | RegExp) {
  fireEvent.click(
    await screen.findByRole("combobox", { name: new RegExp(`^${label}\\b`) }),
  );
  const option = await screen.findByRole("option", { name });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

function gatewayFixture(): AccountsResult<AccountsPage> {
  return {
    status: "ok",
    value: {
      nextCursor: "more-accounts",
      profiles: [
        {
          id: "openrouter-profile",
          label: "OpenRouter",
          protocol: "openai-responses",
          availability: "enabled",
          authKind: "api_key",
          provider: "openrouter",
          models: ["openai/account-model"],
          connection: {
            provider: "openrouter",
            planLabel: "API",
            regionLabel: "Global",
            completionInputKind: "none",
            personalOnly: false,
            limitsContract: "none",
            modelSettings: [
              {
                modelId: "openai/account-model",
                reasoning: { allowed: ["medium"], default: "medium" },
                fast: null,
                tools: { allowed: ["function"], default: "function" },
              },
            ],
          },
        },
      ],
      accounts: [
        {
          connectionId: "connection-1",
          label: "Selected account",
          profileId: "openrouter-profile",
          profileLabel: "OpenRouter",
          state: "active",
          gatewayRevision: 1,
          mirrorRevision: 1,
          binding: {
            id: "binding-1",
            revision: 1,
            state: "active",
            fencePending: false,
          },
        },
      ],
    },
  };
}

describe("ProviderSetupDialog", () => {
  it("starts Add provider empty and keeps tuning on selections, not model-only profile creation", async () => {
    view = { ...view, target: "workspace", sources: apiSources() };
    renderDialog({ kind: "workspace" }, { mode: "add" });
    expect(
      (await screen.findByRole("combobox", { name: "Provider" })).textContent,
    ).toContain("Choose a provider");
    expect(screen.queryByLabelText("Model", { exact: true })).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: "Key storage" }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Read related files/ }),
    ).toBeNull();
    await chooseSelect("Provider", "OpenRouter");
    expect(
      screen
        .getByRole("radio", { name: "GitHub Secrets" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByLabelText("Model", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /^Account\b/ })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Read related files/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Use as workspace default/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Read related files/ }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Model", { exact: true }), {
      target: { value: "" },
    });
    expect(
      screen.queryByRole("checkbox", { name: /Read related files/ }),
    ).toBeNull();
    expect(screen.getByLabelText("Model", { exact: true })).toBeTruthy();
  });

  it.each(["denied", "unavailable"] as const)(
    "does not confuse %s accounts with an empty inventory",
    async (status) => {
      view = {
        ...view,
        sources: apiSources(),
        gatewayApiKeyProviders: ["openrouter"],
      };
      renderDialog(repositoryTarget, {
        gatewayAccounts: { status },
        initialIntent: {
          provider: "openrouter",
          storage: "reviewrouter",
          workspaceId: "workspace_1",
          repositoryIds: ["repo_1"],
        },
      });
      expect(
        await screen.findByRole("button", { name: "Retry accounts" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("link", { name: "Connect account" }),
      ).toBeNull();
      expect(screen.queryByText("Model and review settings")).toBeNull();
    },
  );

  it("does not announce no accounts for an incomplete page with no matches", async () => {
    view = {
      ...view,
      sources: apiSources(),
      gatewayApiKeyProviders: ["openrouter"],
    };
    renderDialog(repositoryTarget, {
      gatewayAccounts: {
        status: "ok",
        value: { accounts: [], profiles: [], nextCursor: "next-page" },
      },
      initialIntent: {
        provider: "openrouter",
        storage: "reviewrouter",
        workspaceId: "workspace_1",
        repositoryIds: ["repo_1"],
      },
    });
    expect(
      await screen.findByText(/No matching accounts on this page/),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Connect account" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Account\b/ })).toBeNull();
    expect(screen.queryByText("Model and review settings")).toBeNull();
  });

  it("waits for explicit account choice then uses its model capabilities without exhausting other pages", async () => {
    view = {
      ...view,
      sources: apiSources(),
      gatewayApiKeyProviders: ["openrouter"],
    };
    renderDialog(repositoryTarget, {
      gatewayAccounts: gatewayFixture(),
      initialIntent: {
        provider: "openrouter",
        storage: "reviewrouter",
        workspaceId: "workspace_1",
        repositoryIds: ["repo_1"],
      },
    });
    await screen.findByRole("combobox", { name: /^Account\b/ });
    expect(screen.queryByText("Model and review settings")).toBeNull();
    await chooseSelect("Account", /^Selected account/);
    expect(await screen.findByRole("combobox", { name: "Model" })).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
    ).toContain("Medium");
    expect(screen.queryByRole("checkbox", { name: /^Fast mode/ })).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: /^Read related files/ }),
    ).toBeTruthy();
    await chooseSelect("Provider", "MiMo Token Plan");
    expect(screen.queryByRole("combobox", { name: /^Account\b/ })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
    ).toContain("High");
  });

  it("mounts the public catalog refresh for editable model creation and preserves the typed model", async () => {
    view = { ...view, target: "workspace", sources: apiSources() };
    const snapshots: ProviderModelCatalogSnapshot[] = (
      ["codex", "claude", "openrouter"] as const
    ).map((providerKind) => ({
      providerKind,
      models: [],
      source: "local",
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      state: "fresh",
      error: null,
      refresh: "cached",
    }));
    const api = vi.fn(
      async ({ providerKind }: { providerKind: string }) =>
        snapshots.find((row) => row.providerKind === providerKind)!,
    );
    renderDialog({ kind: "workspace" }, { mode: "add" }, { snapshots, api });
    await chooseSelect("Provider", "OpenRouter");
    const model = screen.getByLabelText("Model", { exact: true });
    fireEvent.change(model, { target: { value: "custom/preserved-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({
          providerKind: "openrouter",
          forceRefresh: true,
        }),
      ),
    );
    expect(model).toHaveProperty("value", "custom/preserved-model");
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
  });

  it("requires an explicit correction of saved unsupported MiMo settings before unrelated edits can save", async () => {
    const legacy = {
      profileId: "mimo-existing",
      reasoningEffort: "xhigh" as const,
      fastMode: true,
      agenticContext: true,
      requiredHealthy: true,
    };
    view = {
      ...view,
      defaultSelection: null,
      profiles: [
        {
          id: "mimo-existing",
          label: "Saved MiMo",
          model: "mimo-v2.6-pro",
          authMode: "mimo_token_plan_api_key",
          credentialKind: "user_ci_secret",
          gatewayBindingId: null,
          isDefault: false,
          decision: { allowed: true },
          refusedRepositoryCount: 0,
        },
      ],
      repositories: [
        { ...view.repositories[0]!, source: "repository", selection: legacy },
      ],
    };
    renderDialog(repositoryTarget);
    await screen.findByText("Saved MiMo");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^Read related files/ }),
    );
    const save = screen.getByRole("button", {
      name: "Use for this repository",
    });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
    expect(
      screen.getByText(/The saved review depth or fast mode is not supported/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: /^Review depth/ }));
    const high = await screen.findByRole("option", { name: /^High/ });
    fireEvent.mouseMove(high);
    fireEvent.click(high);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
      ).toContain("High"),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /^Fast mode/ }));
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    vi.mocked(saveProviderSetupAction).mockResolvedValueOnce({
      status: "saved",
      results: [
        { repositoryId: "repo_1", fullName: "acme/widget", status: "applied" },
      ],
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(saveProviderSetupAction).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: { kind: "profile", profileId: "mimo-existing" },
          settings: {
            reasoningEffort: "high",
            fastMode: false,
            agenticContext: false,
          },
        }),
      ),
    );
    expect(legacy).toMatchObject({
      reasoningEffort: "xhigh",
      fastMode: true,
      agenticContext: true,
    });
  });
  it.each(apiKeyProviders)(
    "offers exactly two storage choices for $label and preserves the repository on account continuation",
    async (provider) => {
      view = {
        ...view,
        gatewayApiKeyProviders: apiKeyProviders.map((row) => row.id),
        sources: [
          {
            key: "gateway_binding",
            credentialKind: "gateway_binding",
            authMode: "codex_account_gateway",
            decision: { allowed: true },
          },
          ...apiKeyProviders.map((row) => ({
            key: `user_ci_secret:${row.directAuthMode}` as const,
            credentialKind: "user_ci_secret" as const,
            authMode: row.directAuthMode,
            decision: { allowed: true as const },
          })),
          {
            key: "managed_api_key:openrouter_api_key",
            credentialKind: "managed_api_key",
            authMode: "openrouter_api_key",
            decision: { allowed: true },
          },
        ],
      };
      renderDialog(repositoryTarget, {
        initialIntent: {
          provider: provider.id,
          storage: "github_secrets",
          workspaceId: "workspace_1",
          repositoryIds: ["repo_1"],
        },
      });
      const github = await screen.findByRole("radio", {
        name: "GitHub Secrets",
      });
      expect(github.getAttribute("aria-checked")).toBe("true");
      expect(
        screen.getByRole("combobox", { name: "Provider" }).textContent,
      ).toContain(provider.label);
      expect(screen.queryByLabelText("API key")).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: "ReviewRouter" }));
      const link = screen.getByRole("link", {
        name: "Connect account",
      });
      const url = new URL(link.getAttribute("href")!, "https://example.test");
      expect(url.pathname).toBe("/dashboard/setup");
      expect(url.searchParams.get("keyProvider")).toBe(provider.id);
      expect(url.searchParams.getAll("keyRepository")).toEqual(["repo_1"]);
      expect(
        screen.getAllByRole("radio", {
          name: /^(GitHub Secrets|ReviewRouter)$/,
        }),
      ).toHaveLength(2);
      expect(saveProviderSetupAction).not.toHaveBeenCalled();
    },
  );
  it("shows the inherited workspace default as already chosen for a repository", async () => {
    renderDialog(repositoryTarget);
    const inherited = (
      await screen.findByText("Workspace default: Team Claude")
    ).closest("label")!;
    expect(
      inherited.querySelector('[role="radio"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(inherited.textContent).toContain("In use");
    // Nothing changed yet, so there is nothing to save.
    expect(
      (
        screen.getByRole("button", {
          name: "Use the workspace default",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("attaches an existing provider by its ID, never by its credential and model", async () => {
    renderDialog(repositoryTarget);
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for this repository" }),
    );
    await waitFor(() => expect(saveProviderSetupAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveProviderSetupAction).mock.calls[0]![0]).toMatchObject({
      workspaceId: "workspace_1",
      target: { kind: "repositories", repositoryIds: ["repo_1"] },
      provider: { kind: "profile", profileId: "profile_other" },
    });
    // Claude Code needs its secret next: the dialog moves to that step and
    // takes the focus there.
    const secretStep = await screen.findByRole("button", {
      name: "2. Add secret",
    });
    await waitFor(() =>
      expect(secretStep.getAttribute("aria-current")).toBe("step"),
    );
    await waitFor(() => expect(document.activeElement).toBe(secretStep));
  });

  it("returns a repository with its own provider to the workspace default", async () => {
    view = {
      ...view,
      repositories: [
        {
          ...view.repositories[0]!,
          source: "repository",
          selection: selection("profile_other"),
        },
      ],
    };
    renderDialog(repositoryTarget);
    await choose("Workspace default: Team Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use the workspace default" }),
    );
    await waitFor(() =>
      expect(inheritWorkspaceDefaultProviderAction).toHaveBeenCalledWith({
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      }),
    );
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
  });

  it("lets a repository request inheritance without editing legacy MiMo default settings", async () => {
    const legacy = {
      ...selection("profile_default"),
      reasoningEffort: "xhigh" as const,
      fastMode: true,
    };
    view = {
      ...view,
      defaultSelection: legacy,
      profiles: [
        {
          ...claudeProfile("profile_default", "Team MiMo", true),
          authMode: "mimo_token_plan_api_key",
          model: "mimo-v2.6-pro",
        },
        claudeProfile("profile_other", "Second Claude"),
      ],
      repositories: [
        {
          ...view.repositories[0]!,
          source: "repository",
          selection: selection("profile_other"),
        },
      ],
    };
    renderDialog(repositoryTarget);
    await choose("Workspace default: Team MiMo");
    const inherit = screen.getByRole("button", {
      name: "Use the workspace default",
    });
    expect(inherit).toHaveProperty("disabled", false);
    fireEvent.click(inherit);
    await waitFor(() =>
      expect(inheritWorkspaceDefaultProviderAction).toHaveBeenCalledWith({
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      }),
    );
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
    expect(view.defaultSelection).toEqual(legacy);
  });

  it("sets the workspace default and reports each repository of a bulk change", async () => {
    view = { ...view, target: "workspace", repositories: [] };
    renderDialog({ kind: "workspace" });
    await choose("Second Claude");
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    await waitFor(() =>
      expect(saveProviderSetupAction).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: "workspace" },
          provider: { kind: "profile", profileId: "profile_other" },
        }),
      ),
    );
    cleanup();

    view = {
      ...view,
      target: "repositories",
      repositories: ["repo_1", "repo_2"].map((id) => ({
        id,
        fullName: `acme/${id}`,
        source: "workspace" as const,
        selection: null,
        useDefault: { allowed: true as const },
      })),
    };
    vi.mocked(saveProviderSetupAction).mockResolvedValueOnce({
      status: "saved",
      results: [
        { repositoryId: "repo_1", fullName: "acme/repo_1", status: "applied" },
        {
          repositoryId: "repo_2",
          fullName: "acme/repo_2",
          status: "denied",
          reason: "repository_direct_config_required",
        },
      ],
    });
    renderDialog({
      kind: "repositories",
      repositories: [
        { id: "repo_1", fullName: "acme/repo_1" },
        { id: "repo_2", fullName: "acme/repo_2" },
      ],
    });
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for 2 repositories" }),
    );
    expect(
      await screen.findByText(/The provider is set for 1 of 2 repositories/),
    ).toBeTruthy();
    expect(screen.getByText("Not allowed")).toBeTruthy();
    expect(
      screen.getByText(
        "You need maintain or admin access to this repository on GitHub.",
      ),
    ).toBeTruthy();
  });

  it("keeps the bulk target and its results until the dialog closes, then clears the selection", async () => {
    view = {
      ...view,
      repositories: ["repo_1", "repo_2"].map((id) => ({
        id,
        fullName: `acme/${id}`,
        source: "workspace" as const,
        selection: null,
        useDefault: { allowed: true as const },
      })),
    };
    vi.mocked(saveProviderSetupAction).mockResolvedValueOnce({
      status: "saved",
      results: ["repo_1", "repo_2"].map((id) => ({
        repositoryId: id,
        fullName: `acme/${id}`,
        status: "applied" as const,
      })),
    });
    const repositories = ["repo_1", "repo_2"].map((id) => ({
      id,
      fullName: `acme/${id}`,
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositorySelectionProvider
          workspaceId="workspace_1"
          inventory={repositories.map((repository) => ({
            repositoryId: repository.id,
            fullName: repository.fullName,
            available: true,
          }))}
        >
          <BulkProviderSetupAction
            workspaceId="workspace_1"
            mutationsEnabled
            modelOptions={[]}
            gatewayAccounts={undefined}
            agentProfileOptions={[]}
            limit={100}
            editableRepositoryIds={repositories.map(
              (repository) => repository.id,
            )}
          />
          {repositories.map((repository) => (
            <RepositorySelectionCheckbox
              key={repository.id}
              repositoryId={repository.id}
            />
          ))}
        </RepositorySelectionProvider>
      </QueryClientProvider>,
    );
    for (const repository of repositories)
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      );
    fireEvent.click(
      screen.getByRole("button", { name: "Configure providers" }),
    );
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for 2 repositories" }),
    );
    expect(
      await screen.findByText(/The provider is set for all 2 repositories/),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Provider for 2 repositories" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Closing after a save clears the shared table selection.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Configure providers" }),
      ).toHaveProperty("disabled", true),
    );
    for (const repository of repositories)
      expect(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      ).toHaveProperty("checked", false);
    // Every read named the opened repositories, never an emptied selection.
    for (const [url] of vi.mocked(fetch).mock.calls)
      expect(String(url)).toContain("repository=repo_1&repository=repo_2");
  });
});

describe("Configure providers on the shared table selection", () => {
  const renderBulk = (
    count: number,
    { limit, editable }: { limit: number; editable: readonly string[] },
  ) => {
    const repositories = Array.from({ length: count }, (_, index) => ({
      id: `repo_${index + 1}`,
      fullName: `acme/repo_${index + 1}`,
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepositorySelectionProvider
          workspaceId="workspace_1"
          inventory={repositories.map((repository) => ({
            repositoryId: repository.id,
            fullName: repository.fullName,
            available: true,
          }))}
        >
          <BulkProviderSetupAction
            workspaceId="workspace_1"
            mutationsEnabled
            modelOptions={[]}
            gatewayAccounts={undefined}
            agentProfileOptions={[]}
            limit={limit}
            editableRepositoryIds={editable}
          />
          {repositories.map((repository) => (
            <RepositorySelectionCheckbox
              key={repository.id}
              repositoryId={repository.id}
            />
          ))}
        </RepositorySelectionProvider>
      </QueryClientProvider>,
    );
    for (const repository of repositories)
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${repository.fullName}` }),
      );
    return screen.getByRole("button", { name: "Configure providers" });
  };

  it("refuses more repositories than one change may target and says why", () => {
    const trigger = renderBulk(3, {
      limit: 2,
      editable: ["repo_1", "repo_2", "repo_3"],
    });
    expect(trigger).toHaveProperty("disabled", true);
    expect(trigger.getAttribute("title")).toBe(
      "Up to 2 repositories per change.",
    );
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Up to 2 repositories per change.");
  });

  it("refuses a selection with repositories the viewer cannot change", () => {
    const trigger = renderBulk(2, { limit: 100, editable: ["repo_1"] });
    expect(trigger).toHaveProperty("disabled", true);
    expect(
      document.getElementById(trigger.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("1 repository of the selection cannot be changed now.");
  });

  it("opens for an editable selection within the limit", () => {
    const trigger = renderBulk(2, {
      limit: 2,
      editable: ["repo_1", "repo_2"],
    });
    expect(trigger).toHaveProperty("disabled", false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });
});
