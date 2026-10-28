// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupView } from "../../../src/features/provider-setup/provider-setup-model";
import {
  createProviderProfileAction,
  inheritWorkspaceDefaultProviderAction,
  saveProviderSetupAction,
} from "../provider-setup-actions";
import {
  ProviderSetupDialog,
  type ProviderSetupDialogProps,
} from "./provider-setup-dialog";
import { providerSetupQueryKeys } from "./provider-setup-api";
import {
  apiKeyProviders,
  type ProviderModelCatalogSnapshot,
} from "@reviewrouter/features-review-providers";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { ProviderModelCatalogProvider } from "../provider-model-catalog";
import {
  GatewayModelAccountsProvider,
  type GatewayModelAccountsApi,
} from "../gateway-model-account-options";
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
  createProviderProfileAction: vi.fn(),
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
  vi.mocked(createProviderProfileAction).mockResolvedValue({
    status: "saved",
    created: true,
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
  gateway?: { api: GatewayModelAccountsApi },
  client: QueryClient = new QueryClient(),
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
  const gatewayContent = gateway ? (
    <GatewayModelAccountsProvider
      scope="viewer:workspace:workspace_1"
      api={gateway.api}
    >
      {content}
    </GatewayModelAccountsProvider>
  ) : (
    content
  );
  render(
    <QueryClientProvider client={client}>
      {catalog ? (
        <ProviderModelCatalogProvider
          snapshots={catalog.snapshots}
          api={catalog.api}
        >
          {gatewayContent}
        </ProviderModelCatalogProvider>
      ) : (
        gatewayContent
      )}
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
  return client;
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
  it("saves a reusable provider without claiming repository readiness and focuses its next step", async () => {
    view = { ...view, target: "workspace", sources: apiSources() };
    renderDialog({ kind: "workspace" }, { mode: "add" });
    await chooseSelect("Provider", "OpenRouter");
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    const heading = await screen.findByRole("heading", {
      name: "Provider saved",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(createProviderProfileAction).toHaveBeenCalledOnce();
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /Each repository still needs its workflow and connection ready/,
      ),
    ).toBeTruthy();
    const next = screen.getByRole("link", { name: "Finish repository setup" });
    const url = new URL(next.getAttribute("href")!, "https://example.test");
    expect(url.searchParams.get("workspace")).toBe("workspace_1");
    expect(url.searchParams.get("section")).toBe("repositories");
    expect(url.searchParams.has("repository")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("starts a new API provider with the available storage when GitHub Secrets is denied", async () => {
    view = {
      ...view,
      target: "workspace",
      gatewayApiKeyProviders: ["openrouter"],
      sources: apiSources().map((source) =>
        source.key === "user_ci_secret:openrouter_api_key"
          ? {
              ...source,
              decision: { allowed: false, reason: "workspace_admin_required" },
            }
          : source,
      ),
    };
    renderDialog({ kind: "workspace" }, { mode: "add" });
    await chooseSelect("Provider", "OpenRouter");
    expect(
      screen
        .getByRole("radio", { name: "ReviewRouter" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "Connect account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add provider" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(createProviderProfileAction).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps an explicit unavailable storage intent visible without saving (alternative available: %s)",
    async (alternativeAvailable) => {
      view = {
        ...view,
        target: "workspace",
        gatewayApiKeyProviders: alternativeAvailable ? ["openrouter"] : [],
        sources: apiSources().map((source) =>
          source.key === "user_ci_secret:openrouter_api_key"
            ? {
                ...source,
                decision: {
                  allowed: false,
                  reason: "workspace_admin_required",
                },
              }
            : source,
        ),
      };
      renderDialog(
        { kind: "workspace" },
        {
          mode: "add",
          initialIntent: {
            provider: "openrouter",
            storage: "github_secrets",
            workspaceId: "workspace_1",
            repositoryIds: [],
          },
        },
      );
      const github = await screen.findByRole("radio", {
        name: "GitHub Secrets",
      });
      expect(github.getAttribute("aria-checked")).toBe("true");
      expect(github.getAttribute("aria-disabled")).toBe("true");
      expect(
        screen.getByRole("button", { name: "Add provider" }),
      ).toHaveProperty("disabled", true);
      expect(createProviderProfileAction).not.toHaveBeenCalled();
      expect(saveProviderSetupAction).not.toHaveBeenCalled();
    },
  );

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

  it.each(["kimi", "openai"] as const)(
    "derives qualified defaults when opening Make default for an unused Gateway %s profile",
    async (provider) => {
      const fixture = gatewayFixture();
      if (fixture.status !== "ok") throw new Error("fixture unavailable");
      const profile = fixture.value.profiles[0]!;
      profile.id =
        provider === "openai"
          ? "openai-codex-oauth-responses-v1"
          : "kimi-profile";
      profile.models = [provider === "kimi" ? "k3-256k" : "codex-model"];
      profile.connection = {
        ...profile.connection!,
        provider,
        modelSettings: [
          {
            modelId: profile.models[0]!,
            reasoning:
              provider === "kimi"
                ? null
                : { allowed: ["medium"], default: "medium" },
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          },
        ],
      };
      fixture.value.accounts[0]!.profileId = profile.id;
      fixture.value.nextCursor = null;
      view = {
        ...view,
        target: "workspace",
        defaultSelection: null,
        profiles: [
          {
            ...claudeProfile("unused", "Unused provider"),
            model: profile.models[0]!,
            authMode: "codex_account_gateway",
            credentialKind: "gateway_binding",
            gatewayBindingId: "binding-1",
          },
        ],
        sources: apiSources(),
      };
      renderDialog(
        { kind: "workspace" },
        { initialProfileId: "unused", gatewayAccounts: fixture },
      );
      await screen.findByText("Model and review settings");
      expect(screen.queryByText(/saved, unsupported/)).toBeNull();
      if (provider === "kimi")
        expect(
          screen.queryByRole("combobox", { name: /^Review depth/ }),
        ).toBeNull();
      else
        expect(
          screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
        ).toContain("Medium");
      fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
      await waitFor(() =>
        expect(saveProviderSetupAction).toHaveBeenCalledWith(
          expect.objectContaining({
            settings:
              provider === "kimi"
                ? { agenticContext: true, fastMode: false }
                : {
                    reasoningEffort: "medium",
                    agenticContext: true,
                    fastMode: false,
                  },
          }),
        ),
      );
    },
  );

  it("initializes untouched usage from a late exact-account catalog instead of marking synthetic defaults saved", async () => {
    const fixture = gatewayFixture();
    if (fixture.status !== "ok") throw new Error("fixture unavailable");
    const qualified = fixture.value.profiles[0]!;
    const { connection: _connection, ...seed } = qualified;
    void _connection;
    const initial = { ...fixture.value, nextCursor: null, profiles: [seed] };
    view = {
      ...view,
      target: "workspace",
      defaultSelection: null,
      profiles: [
        {
          ...claudeProfile("unused", "Unused provider"),
          model: qualified.models[0]!,
          authMode: "codex_account_gateway",
          credentialKind: "gateway_binding",
          gatewayBindingId: "binding-1",
        },
      ],
      sources: apiSources(),
    };
    type Detail = Awaited<ReturnType<GatewayModelAccountsApi["get"]>>;
    let resolveDetail!: (value: Detail) => void;
    const detail = new Promise<Detail>((resolve) => {
      resolveDetail = resolve;
    });
    const api = {
      list: vi
        .fn<GatewayModelAccountsApi["list"]>()
        .mockResolvedValue({ status: "ok", value: initial }),
      get: vi.fn<GatewayModelAccountsApi["get"]>().mockReturnValue(detail),
    };
    renderDialog(
      { kind: "workspace" },
      {
        initialProfileId: "unused",
        gatewayAccounts: { status: "ok", value: initial },
      },
      undefined,
      { api },
    );
    await screen.findByText("Model and review settings");
    expect(
      screen.queryByRole("combobox", { name: /^Review depth/ }),
    ).toBeNull();
    expect(screen.queryByText(/saved, unsupported/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set as default" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        /Loading review settings for this model|Review settings are unavailable for this model/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Refresh accounts" }),
    ).toBeTruthy();
    await act(async () =>
      resolveDetail({
        status: "ok",
        value: { account: fixture.value.accounts[0]!, profile: qualified },
      }),
    );
    expect(
      (await screen.findByRole("combobox", { name: /^Review depth/ }))
        .textContent,
    ).toContain("Medium");
    expect(screen.queryByText(/saved, unsupported/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set as default" }),
    ).toHaveProperty("disabled", false);
  });

  it("uses the chosen model's defaults when model-only Gateway creation becomes a default selection", async () => {
    const fixture = gatewayFixture();
    if (fixture.status !== "ok") throw new Error("fixture unavailable");
    const profile = fixture.value.profiles[0]!;
    profile.models.push("second/model");
    profile.connection!.modelSettings = [
      ...profile.connection!.modelSettings,
      {
        modelId: "second/model",
        reasoning: { allowed: ["low"], default: "low" },
        fast: null,
        tools: { allowed: ["function"], default: "function" },
      },
    ];
    fixture.value.nextCursor = null;
    view = {
      ...view,
      target: "workspace",
      sources: apiSources(),
      gatewayApiKeyProviders: ["openrouter"],
    };
    renderDialog(
      { kind: "workspace" },
      {
        mode: "add",
        gatewayAccounts: fixture,
        initialIntent: {
          provider: "openrouter",
          storage: "reviewrouter",
          workspaceId: "workspace_1",
          repositoryIds: [],
        },
      },
    );
    await chooseSelect("Account", /^Selected account/);
    expect(
      screen.queryByRole("combobox", { name: /^Review depth/ }),
    ).toBeNull();
    await chooseSelect("Model", "second/model");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Use as workspace default/ }),
    );
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
    ).toContain("Low");
    fireEvent.click(
      screen.getByRole("button", { name: "Add and make default" }),
    );
    await waitFor(() =>
      expect(saveProviderSetupAction).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: {
            reasoningEffort: "low",
            fastMode: false,
            agenticContext: true,
          },
          provider: expect.objectContaining({ model: "second/model" }),
        }),
      ),
    );
  });

  it.each(["narrower depth", "reasoning removed"] as const)(
    "retains explicitly tuned new Gateway settings after %s refresh until corrected",
    async (scenario) => {
      const fixture = gatewayFixture();
      if (fixture.status !== "ok") throw new Error("fixture unavailable");
      const profile = fixture.value.profiles[0]!;
      profile.id = "openai-codex-oauth-responses-v1";
      profile.connection = {
        ...profile.connection!,
        provider: "openai",
        modelSettings: [
          {
            modelId: profile.models[0]!,
            reasoning: { allowed: ["medium", "high"], default: "medium" },
            fast: { allowed: ["balanced", "fast"], default: "balanced" },
            tools: { allowed: ["function"], default: "function" },
          },
        ],
      };
      const account = fixture.value.accounts[0]!;
      account.profileId = profile.id;
      account.modelCatalog = {
        status: "snapshot",
        source: "codex",
        fetchedAt: "2026-10-26T12:00:00Z",
        models: profile.models,
      };
      fixture.value.nextCursor = null;
      const refreshed = {
        ...profile,
        connection: {
          ...profile.connection,
          modelSettings: [
            {
              ...profile.connection.modelSettings[0]!,
              reasoning:
                scenario === "reasoning removed"
                  ? null
                  : { allowed: ["medium"], default: "medium" },
              fast: null,
            },
          ],
        },
      };
      const api = {
        list: vi
          .fn<GatewayModelAccountsApi["list"]>()
          .mockResolvedValue(fixture),
        get: vi
          .fn<GatewayModelAccountsApi["get"]>()
          .mockImplementation(async (_id, options) => ({
            status: "ok",
            value: {
              account,
              profile: options?.forceRefresh ? refreshed : profile,
            },
          })),
      };
      view = { ...view, sources: apiSources() };
      renderDialog(repositoryTarget, { gatewayAccounts: fixture }, undefined, {
        api,
      });
      await choose("Add a new provider");
      await chooseSelect("Provider", /^Connected account/);
      await chooseSelect("Account", /^Selected account/);
      await chooseSelect("Review depth", /^Medium/);
      await chooseSelect("Review depth", /^High/);
      fireEvent.click(screen.getByRole("checkbox", { name: /^Fast mode/ }));
      fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
      await screen.findByText(
        /The selected review depth or fast mode is not supported/,
      );
      const save = screen.getByRole("button", {
        name: "Use for this repository",
      });
      expect(save).toHaveProperty("disabled", true);
      expect(
        screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
      ).toContain("selected, unsupported");
      expect(
        screen.getByRole("checkbox", { name: /^Fast mode/ }),
      ).toHaveProperty("checked", true);
      expect(saveProviderSetupAction).not.toHaveBeenCalled();
      await chooseSelect(
        "Review depth",
        scenario === "reasoning removed" ? "Account default" : /^Medium/,
      );
      fireEvent.click(screen.getByRole("checkbox", { name: /^Fast mode/ }));
      expect(save).toHaveProperty("disabled", false);
      expect(saveProviderSetupAction).not.toHaveBeenCalled();
    },
  );

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
    // Wait for opening autofocus before interacting with the modal.
    await waitFor(() =>
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
        true,
      ),
    );
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
    const returnLink = screen.getByRole("link", {
      name: "Back to repository setup",
    });
    const url = new URL(
      returnLink.getAttribute("href")!,
      "https://example.test",
    );
    expect(url.searchParams.get("workspace")).toBe("workspace_1");
    expect(url.searchParams.get("repository")).toBe("acme/widget");
    expect(url.searchParams.get("section")).toBe("repositories");
  });

  it("keeps focus on the credential step when opening autofocus is still queued", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const flushFrame = async () => {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(performance.now());
      });
    };

    renderDialog(repositoryTarget);
    const trigger = screen.getByText("Change provider");
    await choose("Second Claude");
    // The opening dialog's autofocus has not run yet. A fast save can move to
    // credentials before that pending frame focuses the first dialog control.
    expect(frames.size).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Use for this repository" }),
    );
    const secretStep = await screen.findByRole("button", {
      name: "2. Add secret",
    });
    await waitFor(() =>
      expect(secretStep.getAttribute("aria-current")).toBe("step"),
    );
    await flushFrame();
    expect(document.activeElement).toBe(secretStep);
    await act(async () => {
      fireEvent.keyDown(secretStep, { key: "Escape" });
    });
    await flushFrame();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps repository step navigation locked until a provider save finishes", async () => {
    let finishSave!: (
      result: Awaited<ReturnType<typeof saveProviderSetupAction>>,
    ) => void;
    vi.mocked(saveProviderSetupAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    renderDialog(repositoryTarget);
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", { name: "Use for this repository" }),
    );
    await waitFor(() => expect(saveProviderSetupAction).toHaveBeenCalledOnce());

    const providerStep = screen.getByRole("button", { name: "1. Provider" });
    const secretStep = screen.getByRole("button", { name: "2. Add secret" });
    // Leaving and reentering the choice step must not create a fresh form
    // that can submit a second mutation while the first save is unresolved.
    fireEvent.click(secretStep);
    fireEvent.click(providerStep);
    await choose("Second Claude");
    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Saving\.\.\.|Use for this repository)$/,
      }),
    );

    expect(saveProviderSetupAction).toHaveBeenCalledOnce();
    expect(providerStep).toHaveProperty("disabled", true);
    expect(secretStep).toHaveProperty("disabled", true);
    expect(providerStep.getAttribute("aria-current")).toBe("step");

    await act(async () => {
      finishSave({
        status: "saved",
        results: [
          {
            repositoryId: "repo_1",
            fullName: "acme/widget",
            status: "applied",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(providerStep).toHaveProperty("disabled", false);
      expect(secretStep).toHaveProperty("disabled", false);
      expect(secretStep.getAttribute("aria-current")).toBe("step");
    });
    fireEvent.click(providerStep);
    expect(providerStep.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Second Claude")).toBeTruthy();
    expect(saveProviderSetupAction).toHaveBeenCalledOnce();
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

  it("does not inherit a workspace default that disappeared after it was chosen", async () => {
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
    const client = renderDialog(repositoryTarget);
    await choose("Workspace default: Team Claude");
    expect(
      screen.getByRole("button", { name: "Use the workspace default" }),
    ).toHaveProperty("disabled", false);

    // Another administrator removed the default, but this repository still
    // has its own provider. A stale choice must not clear that selection.
    view = {
      ...view,
      defaultSelection: null,
      profiles: view.profiles.map((profile) => ({
        ...profile,
        isDefault: false,
      })),
    };
    await act(async () => {
      await client.refetchQueries({
        queryKey: providerSetupQueryKeys.view("workspace_1", ["repo_1"]),
        exact: true,
      });
    });
    await waitFor(() =>
      expect(screen.queryByText("Workspace default: Team Claude")).toBeNull(),
    );

    const inherit = screen.getByRole("button", {
      name: "Use the workspace default",
    });
    expect(inherit).toHaveProperty("disabled", true);
    fireEvent.click(inherit);
    expect(inheritWorkspaceDefaultProviderAction).not.toHaveBeenCalled();
    expect(saveProviderSetupAction).not.toHaveBeenCalled();

    // Choosing an available provider is still possible after the refresh.
    await choose("Team Claude");
    expect(
      screen.getByRole("button", { name: "Use for this repository" }),
    ).toHaveProperty("disabled", false);
  });

  it.each(["default", "profile"] as const)(
    "allows choosing a new provider when the last %s choice disappears",
    async (choiceKind) => {
      view = { ...view, sources: apiSources() };
      const client = renderDialog(repositoryTarget);
      await choose(
        choiceKind === "default"
          ? "Workspace default: Team Claude"
          : "Second Claude",
      );

      view = {
        ...view,
        defaultSelection: null,
        profiles: [],
        repositories: view.repositories.map((repository) => ({
          ...repository,
          source: "none" as const,
          selection: null,
        })),
      };
      await act(async () => {
        await client.refetchQueries({
          queryKey: providerSetupQueryKeys.view("workspace_1", ["repo_1"]),
          exact: true,
        });
      });
      await screen.findByRole("heading", { name: "Add the first provider" });

      const add = (await screen.findByText("Add a new provider"))
        .closest("label")!
        .querySelector('[role="radio"]')!;
      // Recover explicitly; a refresh must not silently replace the choice.
      expect(add.getAttribute("aria-checked")).toBe("false");
      expect(
        screen.queryByRole("combobox", { name: /^Provider\b/ }),
      ).toBeNull();
      expect(saveProviderSetupAction).not.toHaveBeenCalled();
      expect(inheritWorkspaceDefaultProviderAction).not.toHaveBeenCalled();

      fireEvent.click(add);
      await chooseSelect("Provider", "OpenRouter");
      const save = screen.getByRole("button", {
        name: "Use for this repository",
      });
      expect(save).toHaveProperty("disabled", false);
      fireEvent.click(save);
      await waitFor(() =>
        expect(saveProviderSetupAction).toHaveBeenCalledOnce(),
      );
      expect(
        vi.mocked(saveProviderSetupAction).mock.calls[0]![0],
      ).toMatchObject({
        target: { kind: "repositories", repositoryIds: ["repo_1"] },
        provider: {
          kind: "new",
          credential: {
            kind: "user_ci_secret",
            authMode: "openrouter_api_key",
          },
        },
      });
      expect(inheritWorkspaceDefaultProviderAction).not.toHaveBeenCalled();
    },
  );

  it("preserves an unsaved provider choice through a failed refresh and blocks saving until retry succeeds", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderDialog(repositoryTarget, {}, undefined, undefined, client);
    await choose("Second Claude");
    const expectSecondClaudeChosen = () => {
      const option = screen.getByText("Second Claude").closest("label")!;
      expect(
        option.querySelector('[role="radio"]')!.getAttribute("aria-checked"),
      ).toBe("true");
    };
    expectSecondClaudeChosen();
    expect(
      screen.getByRole("button", { name: "Use for this repository" }),
    ).toHaveProperty("disabled", false);
    vi.mocked(fetch).mockRejectedValueOnce(
      new Error("provider_setup_unavailable"),
    );
    const queryKey = providerSetupQueryKeys.view("workspace_1", ["repo_1"]);

    await act(async () => {
      await client.refetchQueries({ queryKey, exact: true });
    });

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(client.getQueryState(queryKey)?.status).toBe("error");
    expect(client.getQueryData(queryKey)).toBeDefined();
    const save = screen.getByRole("button", {
      name: "Use for this repository",
    });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(save);
    expect(saveProviderSetupAction).not.toHaveBeenCalled();
    expectSecondClaudeChosen();
    expect(
      screen.queryByText("Changes are turned off for this dashboard."),
    ).toBeNull();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Use for this repository" }),
      ).toHaveProperty("disabled", false),
    );
    expectSecondClaudeChosen();
    fireEvent.click(
      screen.getByRole("button", { name: "Use for this repository" }),
    );
    await waitFor(() => expect(saveProviderSetupAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveProviderSetupAction).mock.calls[0]![0]).toMatchObject({
      provider: { kind: "profile", profileId: "profile_other" },
    });
    expect(inheritWorkspaceDefaultProviderAction).not.toHaveBeenCalled();
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
    const heading = await screen.findByRole("heading", {
      name: "Workspace default saved",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      screen.getByRole("link", { name: "Finish repository setup" }),
    ).toBeTruthy();
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
