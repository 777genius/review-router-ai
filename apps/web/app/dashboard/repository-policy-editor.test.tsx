// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  readReviewConfigurationForm,
  readRepositoryReviewPolicyForm,
  readReviewPolicyExpectedVersion,
} from "./dashboard-action-form-readers";
import {
  type ReviewConfiguration,
  type ReviewProviderConfiguration,
} from "@reviewrouter/features-review-config";
import {
  checkProviderRepositorySecretClientAction,
  clearRepositoryReviewConfigClientAction,
  saveRepositoryReviewConfigClientAction,
  saveWorkspaceReviewConfigClientAction,
} from "./actions";
import {
  clearProviderSecretStatusCacheForTest,
  ReviewConfigForm,
  WorkspaceReviewConfigForm,
  RepositoryPolicyEditor,
  RepositoryPolicyOverrideDetails,
} from "./repository-policy-editor";
import type {
  AccountView,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  GatewayModelAccountsProvider,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";
import type { GatewayAgentProfileOption } from "../../src/server/gateway-agent-profile-options";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("./actions", () => ({
  checkProviderRepositorySecretClientAction: vi.fn(),
  clearRepositoryReviewConfigClientAction: vi.fn(),
  saveRepositoryReviewConfigClientAction: vi.fn(),
  saveWorkspaceReviewConfigClientAction: vi.fn(),
}));

const workspacePolicy: ReviewConfiguration = {
  schemaVersion: 3,
  providers: [
    {
      kind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
};

const modelOptions = [
  {
    value: "gpt-5.6-sol",
    label: "gpt-5.6-sol",
    provider: "codex" as const,
    description: "Codex default model.",
  },
  {
    value: "gpt-5.5",
    label: "gpt-5.5",
    provider: "codex" as const,
    description: "Codex model.",
  },
  {
    value: "poolside/laguna-m.1:free",
    label: "Poolside: Laguna M.1",
    provider: "openrouter" as const,
    description: "poolside/laguna-m.1:free - $0/$0 per 1M - 131K context",
    badge: "FREE RECOMMENDED" as const,
  },
  {
    value: "anthropic/claude-sonnet-4.5",
    label: "Anthropic: Claude Sonnet 4.5",
    provider: "openrouter" as const,
    description:
      "anthropic/claude-sonnet-4.5 - $3.00/$15.00 per 1M input/output",
    badge: "PAID" as const,
  },
  {
    value: "sonnet",
    label: "sonnet",
    provider: "claude" as const,
    description: "Claude Code default model.",
  },
  {
    value: "mimo-v2.6-pro",
    label: "mimo-v2.6-pro",
    provider: "codex-mimo" as const,
    description: "MiMo Token Plan public engine model.",
  },
  {
    value: "opus",
    label: "opus",
    provider: "claude" as const,
    description: "Claude Code model.",
  },
];

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(clearRepositoryReviewConfigClientAction).mockReset();
  vi.mocked(saveRepositoryReviewConfigClientAction).mockReset();
  vi.mocked(saveWorkspaceReviewConfigClientAction).mockReset();
  clearProviderSecretStatusCacheForTest();
  cleanup();
});

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, " ") ?? "";
}

const gatewayPage: AccountsPage = {
  profiles: [
    {
      id: "profile-mimo",
      label: "MiMo",
      provider: "codex-mimo",
      protocol: "openai-responses",
      models: ["mimo-v2-pro", "openai/gpt-5.6-sol"],
    },
    {
      id: "profile-codex",
      label: "Codex",
      provider: "codex",
      protocol: "openai-responses",
      models: ["gpt-6.1-sol"],
    },
  ],
  accounts: ["mimo", "codex"].map(
    (name): AccountView => ({
      connectionId: `connection-${name}`,
      label: `Workspace ${name}`,
      profileId: `profile-${name}`,
      profileLabel: name,
      state: "active",
      gatewayRevision: 1,
      mirrorRevision: 1,
      binding: {
        id: `binding-${name}`,
        revision: 1,
        state: "active",
        fencePending: false,
      },
    }),
  ),
  nextCursor: null,
};
function choose(label: string, option: RegExp): void {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

const ocrAgentProfileOption: GatewayAgentProfileOption = {
  profileRef: "ocr-prod-1",
  agentKind: "ocr",
  label: "ocr-prod-1",
  description: "Approved OpenCodeReview agent profile (native context tools).",
};

function gatewayProviderFixture(): ReviewProviderConfiguration {
  return {
    ...workspacePolicy.providers[0]!,
    kind: "codex" as const,
    authMode: "codex_account_gateway" as const,
    gatewayBindingId: "binding-mimo",
    gatewayProfileRef: "profile-mimo",
    model: "mimo-v2-pro",
  };
}

describe("ReviewConfigForm", () => {
  it("keeps explicit zero and false overrides and removes them when reset to inherit", () => {
    const { container } = render(
      <ReviewConfigForm
        action={vi.fn()}
        config={{
          ...workspacePolicy,
          limits: { ...workspacePolicy.limits, inlineMaxComments: 0 },
        }}
        repositoryPolicy={{
          schemaVersion: 3,
          limits: { inlineMaxComments: 0 },
          investigationRollout: { productionEffectsEnabled: false },
        }}
        hiddenFields={[]}
        modelOptions={modelOptions}
        mutationsEnabled={true}
        submitLabel="Save"
      />,
    );
    const form = container.querySelector("form")!;
    const zeroMode = form.querySelector<HTMLSelectElement>(
      '[name="policyMode.limits.inlineMaxComments"]',
    )!;
    const falseMode = form.querySelector<HTMLSelectElement>(
      '[name="policyMode.investigationRollout.productionEffectsEnabled"]',
    )!;
    expect(zeroMode.value).toBe("override");
    expect(falseMode.value).toBe("override");
    expect(readRepositoryReviewPolicyForm(new FormData(form))).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: 0 },
      investigationRollout: { productionEffectsEnabled: false },
    });
    fireEvent.change(zeroMode, { target: { value: "inherit" } });
    fireEvent.change(falseMode, { target: { value: "inherit" } });
    expect(readRepositoryReviewPolicyForm(new FormData(form))).toEqual({
      schemaVersion: 3,
    });
  });

  it("shows only overridden fields and reveals a field added from the menu", () => {
    const { container } = render(
      <ReviewConfigForm
        action={vi.fn()}
        config={workspacePolicy}
        repositoryPolicy={{
          schemaVersion: 3,
          limits: { inlineMaxComments: 0 },
        }}
        hiddenFields={[]}
        modelOptions={modelOptions}
        mutationsEnabled={true}
        submitLabel="Save"
      />,
    );
    const form = container.querySelector("form")!;
    expect(
      form.querySelector('select[name="policyMode.limits.inlineMaxComments"]'),
    ).not.toBeNull();
    expect(
      form.querySelector('select[name="policyMode.providers"]'),
    ).toBeNull();
    expect(providersMode()).toBe("inherit");
    expect(readRepositoryReviewPolicyForm(new FormData(form))).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: workspacePolicy.limits.inlineMaxComments },
    });

    addOverrideField("Providers");
    expect(
      form.querySelector('select[name="policyMode.providers"]'),
    ).not.toBeNull();
    expect(readRepositoryReviewPolicyForm(new FormData(form))).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: workspacePolicy.limits.inlineMaxComments },
      providers: workspacePolicy.providers,
    });
  });

  it("offers qualified MiMo Gateway reasoning with High default and explicit invalid-value repair", () => {
    const page = {
      ...gatewayPage,
      profiles: gatewayPage.profiles.map((profile) =>
        profile.id === "profile-mimo"
          ? { ...profile, models: ["mimo-v2.6-pro"] }
          : profile,
      ),
    };
    const action = vi.fn();
    const props = {
      action,
      modelOptions,
      gatewayAccounts: { status: "ok", value: page } as const,
      hiddenFields: [],
      mutationsEnabled: true,
      submitLabel: "Save",
    };
    const first = render(
      <ReviewConfigForm {...props} config={workspacePolicy} />,
    );
    choose("Provider", /^MiMo$/);
    choose("Connection method", /ReviewRouter \/ sub2api/);
    choose("Account", /Workspace mimo/);
    choose("Model", /^mimo-v2.6-pro$/);
    const form = document.querySelector("form")!;
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0]!
        .reasoningEffort,
    ).toBe("high");
    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: /^Low/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^Medium/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^High/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /High/ }));
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
    const saved = {
      ...readReviewConfigurationForm(new FormData(form)).providers[0]!,
      reasoningEffort: "xhigh",
    } satisfies ReviewProviderConfiguration;
    first.unmount();
    render(
      <ReviewConfigForm
        {...props}
        config={{
          ...workspacePolicy,

          providers: [saved],
        }}
      />,
    );
    const repairedForm = document.querySelector("form")!;
    expect(
      readReviewConfigurationForm(new FormData(repairedForm)).providers[0]!
        .reasoningEffort,
    ).toBe("xhigh");
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.submit(repairedForm);
    expect(action).not.toHaveBeenCalled();
    expect(pageText()).toContain("The saved value has not been changed");
    choose("Reasoning effort", /High/);
    expect(
      readReviewConfigurationForm(new FormData(repairedForm)).providers[0]!
        .reasoningEffort,
    ).toBe("high");
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
    choose("Provider", /OpenAI \/ Codex/);
    choose("Account", /Workspace codex/);
    choose("Model", /^gpt-6.1-sol$/);
    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
    expect(screen.getByRole("option", { name: /XHigh/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Max/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ultra/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /^Low/ }));
    choose("Provider", /^MiMo$/);
    choose("Account", /Workspace mimo/);
    choose("Model", /^mimo-v2.6-pro$/);
    expect(
      readReviewConfigurationForm(new FormData(repairedForm)).providers[0]!
        .reasoningEffort,
    ).toBe("low");
  });

  it.each(["remove-direct", "remove-gateway", "switch-to-direct"])(
    "blocks unsupported saved gateway combinations until explicit %s repair",
    async (repair) => {
      const provider = {
        ...workspacePolicy.providers[0]!,
        kind: "codex",
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding-mimo",
        gatewayProfileRef: "profile-mimo",
        model: "mimo-v2-pro",
        fastMode: false,
        requiredHealthy: true,
      } satisfies ReviewProviderConfiguration;
      const extra =
        repair === "remove-gateway"
          ? { ...provider, model: "openai/gpt-5.6-sol", requiredHealthy: false }
          : {
              ...openRouterReviewConfiguration().providers[0]!,
              model: "anthropic/claude-sonnet-4.5",
            };
      const action = vi.fn();
      render(
        <ReviewConfigForm
          action={action}
          config={{
            ...workspacePolicy,
            providers: [provider, extra],
            execution: { ...workspacePolicy.execution, providerLimit: 2 },
          }}
          gatewayAccounts={{ status: "ok", value: gatewayPage }}
          modelOptions={modelOptions}
          hiddenFields={[]}
          mutationsEnabled={true}
          submitLabel="Save"
        />,
      );
      const form = document.querySelector("form")!;
      const payload = () => readReviewConfigurationForm(new FormData(form));
      const submit = screen.getByRole("button", { name: "Save" });
      const add = screen.getByRole("button", { name: "Add provider" });
      expect(payload().providers).toEqual([provider, extra]);
      expect(submit.hasAttribute("disabled")).toBe(true);
      fireEvent.submit(form);
      expect(action).not.toHaveBeenCalled();
      expect(pageText()).toContain(
        "Account Gateway currently supports only one provider",
      );

      if (repair === "switch-to-direct") {
        fireEvent.click(
          screen.getAllByRole("combobox", {
            name: "Connection method",
          })[0]!,
        );
        fireEvent.click(screen.getByRole("option", { name: /GitHub Secrets/ }));
        fireEvent.change(
          screen.getAllByRole("textbox", { name: "Model" })[0]!,
          { target: { value: "mimo-v2.6-pro" } },
        );
        expect(payload().providers[1]).toEqual(extra);
        expect(payload().providers[0]!.authMode).toBe(
          "mimo_token_plan_api_key",
        );
        expect(payload().providers[0]!.gatewayBindingId).toBeUndefined();
        expect(payload().providers[0]!.gatewayProfileRef).toBeUndefined();
        expect(add.hasAttribute("disabled")).toBe(false);
        fireEvent.click(add);
        expect(new FormData(form).get("providerCount")).toBe("3");
        fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[2]!);
        expect(payload().providers).toHaveLength(2);
        fireEvent.click(
          screen.getAllByRole("combobox", {
            name: "Connection method",
          })[0]!,
        );
        const pool = screen.getByRole("option", {
          name: /ReviewRouter \/ sub2api/,
        });
        expect(pool.getAttribute("aria-disabled")).toBe("true");
        expect(pool.textContent).toContain("only one provider");
        fireEvent.keyDown(pool, { key: "Escape" });
      } else {
        fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
        expect(payload().providers).toEqual([provider]);
        expect(add.hasAttribute("disabled")).toBe(true);
        fireEvent.click(add);
        expect(payload().providers).toEqual([provider]);
      }
      expect(submit.hasAttribute("disabled")).toBe(false);
      fireEvent.click(submit);
      await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
      const saved = readReviewConfigurationForm(action.mock.calls[0]![0]);
      expect(saved.providers).toEqual(payload().providers);
      expect(
        saved.providers.some((candidate) => candidate.requiredHealthy),
      ).toBe(true);
    },
  );

  // Regression: a newly configured provider could not enter gateway mode or submit a scoped tuple.
  it.each(["workspace", "repository"])(
    "chooses gateway account/profile/model in the %s form",
    async (scope) => {
      vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
        status: "available_repository",
      });
      const save =
        scope === "workspace"
          ? saveWorkspaceReviewConfigClientAction
          : saveRepositoryReviewConfigClientAction;
      vi.mocked(save).mockResolvedValue({
        params: { notice: "review_config_saved" },
      });
      const common = {
        workspaceId: "workspace_1",
        modelOptions,
        gatewayAccounts: { status: "ok", value: gatewayPage } as const,
        mutationsEnabled: true,
      };
      if (scope === "workspace")
        render(
          <WorkspaceReviewConfigForm
            expectedVersion={1}
            {...common}
            config={workspacePolicy}
          />,
        );
      else {
        render(
          <RepositoryPolicyEditor
            {...common}
            effectiveConfig={workspacePolicy}
            repositoryConfig={null}
            repository={{
              id: "repo_1",
              fullName: "test/disposable",
              selected: true,
              archived: false,
            }}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
      }
      if (scope === "repository") {
        addOverrideField("Providers");
      }
      choose("Provider", /^MiMo$/);
      const legacySecretChecks = vi.mocked(
        checkProviderRepositorySecretClientAction,
      ).mock.calls.length;
      choose("Connection method", /ReviewRouter \/ sub2api/);
      const submit = screen.getByRole("button", {
        name: /Save workspace default|Save repo settings/,
      });
      expect(submit.hasAttribute("disabled")).toBe(true);
      fireEvent.submit(document.querySelector("form")!);
      expect(save).not.toHaveBeenCalled();
      choose("Account", /Workspace mimo/);
      fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
      expect(screen.queryByRole("option", { name: "gpt-6.1-sol" })).toBeNull();
      fireEvent.click(screen.getByRole("option", { name: "mimo-v2-pro" }));
      expect(submit.hasAttribute("disabled")).toBe(false);
      choose("Provider", /OpenAI \/ Codex/);
      choose("Account", /Workspace codex/);
      expect(submit.hasAttribute("disabled")).toBe(true);
      fireEvent.submit(document.querySelector("form")!);
      expect(save).not.toHaveBeenCalled();
      choose("Model", /^gpt-6.1-sol$/);
      fireEvent.click(submit);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      const payload = vi.mocked(save).mock.calls[0]![0];
      expect(payload.get("workspaceId")).toBe("workspace_1");
      if (scope === "repository")
        expect(payload.get("repositoryId")).toBe("repo_1");
      expect(readReviewConfigurationForm(payload).providers[0]!).toMatchObject({
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding-codex",
        gatewayProfileRef: "profile-codex",
        model: "gpt-6.1-sol",
        requiredHealthy: true,
      });
      expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(
        legacySecretChecks,
      );
    },
  );

  // Regression: a sole ready account/model left two empty mandatory pickers
  // after entering the account pool, so the form could not be saved at once.
  it("auto-selects a sole gateway account and model when entering the account pool", () => {
    const page: AccountsPage = {
      profiles: [
        {
          id: "profile-mimo",
          label: "MiMo",
          provider: "codex-mimo",
          protocol: "openai-responses",
          models: ["mimo-v2.6-pro"],
        },
      ],
      accounts: [gatewayPage.accounts[0]!],
      nextCursor: null,
    };
    render(
      <ReviewConfigForm
        action={vi.fn()}
        config={workspacePolicy}
        modelOptions={modelOptions}
        gatewayAccounts={{ status: "ok", value: page }}
        hiddenFields={[]}
        mutationsEnabled={true}
        submitLabel="Save"
      />,
    );
    choose("Provider", /^MiMo$/);
    choose("Connection method", /ReviewRouter \/ sub2api/);
    expect(
      readReviewConfigurationForm(new FormData(document.querySelector("form")!))
        .providers[0]!,
    ).toMatchObject({
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2.6-pro",
      reasoningEffort: "high",
    });
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it.each([
    ["workspace", 3],
    ["policy", 11],
    ["repositories", 11],
    ["workspace", null],
    ["policy", null],
    ["repositories", null],
  ] as const)(
    "submits %s policy with its exact opaque-head or new-target CAS %s",
    async (surface, expectedVersion) => {
      const config: ReviewConfiguration = {
        ...workspacePolicy,
        providers: [
          {
            ...workspacePolicy.providers[0]!,
            kind: "codex",
            authMode: "codex_account_gateway",
            gatewayBindingId: "binding-codex",
            gatewayProfileRef: "profile-codex",
            model: "gpt-6.1-sol",
          },
        ],
      };
      const save =
        surface === "workspace"
          ? saveWorkspaceReviewConfigClientAction
          : saveRepositoryReviewConfigClientAction;
      vi.mocked(save).mockResolvedValue({
        params: { notice: "review_config_saved" },
      });
      const common = {
        workspaceId: "workspace_1",
        modelOptions,
        expectedVersion,
        gatewayAccounts: { status: "ok", value: gatewayPage } as const,
        mutationsEnabled: true,
      };
      const repository = {
        id: "repo_1",
        fullName: "test/disposable",
        selected: true,
        archived: false,
      };
      if (surface === "workspace") {
        render(<WorkspaceReviewConfigForm {...common} config={config} />);
      } else if (surface === "policy") {
        render(
          <RepositoryPolicyOverrideDetails
            {...common}
            repository={repository}
            repositoryConfig={null}
            effectiveConfig={config}
            configVersion={99}
          />,
        );
        fireEvent.click(
          screen.getByRole("button", { name: /test\/disposable/ }),
        );
      } else {
        render(
          <RepositoryPolicyEditor
            {...common}
            repository={repository}
            repositoryConfig={null}
            effectiveConfig={config}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
      }
      if (surface !== "workspace") {
        addOverrideField("Providers");
      }
      fireEvent.click(
        screen.getByRole("button", {
          name: /Save workspace default|Save override|Save repo settings|Replace legacy override/,
        }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      const submitted = vi.mocked(save).mock.calls[0]![0];
      expect(readReviewPolicyExpectedVersion(submitted)).toBe(expectedVersion);
      expect(submitted.get("workspaceId")).toBe("workspace_1");
      if (surface === "workspace") {
        expect(readReviewConfigurationForm(submitted)).toEqual(config);
      } else {
        expect(submitted.get("repositoryId")).toBe("repo_1");
        expect(readRepositoryReviewPolicyForm(submitted)).toEqual({
          schemaVersion: 3,
          providers: config.providers,
        });
      }
    },
  );

  it.each([
    ["policy", null],
    ["repositories", null],
    ["policy", 11],
    ["repositories", 11],
  ] as const)(
    "uses exact target CAS in %s when its displayed config inherits workspace v3 (%s)",
    async (surface, expectedVersion) => {
      const config = openRouterReviewConfiguration();
      vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
        status: "available_repository",
      });
      vi.mocked(saveRepositoryReviewConfigClientAction).mockResolvedValue({
        params: { notice: "repository_review_config_saved" },
      });
      const common = {
        workspaceId: "workspace_1",
        modelOptions,
        expectedVersion,
        repository: {
          id: "repo_1",
          fullName: "test/disposable",
          selected: true,
          archived: false,
        },
        repositoryConfig: {
          version: 3,
          policy: { schemaVersion: 3 as const },
          config,
        },
        effectiveConfig: config,
        mutationsEnabled: true,
      };
      if (surface === "policy") {
        render(
          <RepositoryPolicyOverrideDetails {...common} configVersion={3} />,
        );
        fireEvent.click(
          screen.getByRole("button", { name: /test\/disposable/ }),
        );
      } else {
        render(<RepositoryPolicyEditor {...common} />);
        fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
      }
      // Saving all Inherit appends a sparse policy without calling destructive clear.
      fireEvent.click(
        screen.getByRole("button", {
          name: /Update override|Update repo settings/,
        }),
      );
      await waitFor(() =>
        expect(saveRepositoryReviewConfigClientAction).toHaveBeenCalledOnce(),
      );
      const submitted = vi.mocked(saveRepositoryReviewConfigClientAction).mock
        .calls[0]![0];
      expect(readReviewPolicyExpectedVersion(submitted)).toBe(expectedVersion);
      expect(submitted.get("policyExpectedVersion")).toBe(
        expectedVersion === null ? "none" : "11",
      );
      expect(readRepositoryReviewPolicyForm(submitted)).toEqual({
        schemaVersion: 3,
      });
      expect(clearRepositoryReviewConfigClientAction).not.toHaveBeenCalled();
    },
  );

  it("ignores an unavailable provider draft when providers inherit workspace", () => {
    const provider = {
      ...workspacePolicy.providers[0]!,
      kind: "codex" as const,
      authMode: "codex_account_gateway" as const,
      gatewayBindingId: "removed-binding",
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2-pro",
    };
    render(
      <ReviewConfigForm
        action={vi.fn()}
        config={{ ...workspacePolicy, providers: [provider] }}
        repositoryPolicy={{
          schemaVersion: 3,
          providers: [provider],
          investigationRollout: { productionEffectsEnabled: false },
        }}
        modelOptions={modelOptions}
        gatewayAccounts={{ status: "unavailable" }}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
    const mode = document.querySelector('select[name="policyMode.providers"]')!;
    fireEvent.change(mode, { target: { value: "inherit" } });
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen
        .getByRole("combobox", {
          name: "Connection method",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(pageText()).toContain("Will use workspace defaults after save");
    expect(
      readRepositoryReviewPolicyForm(
        new FormData(document.querySelector("form")!),
      ),
    ).toEqual({
      schemaVersion: 3,
      investigationRollout: { productionEffectsEnabled: false },
    });
  });

  it("requires confirmation before removing a legacy override and retains raw CAS", async () => {
    vi.mocked(clearRepositoryReviewConfigClientAction).mockResolvedValue({
      params: { notice: "repository_review_config_cleared" },
    });
    const editor = (version: number) => (
      <RepositoryPolicyEditor
        workspaceId="workspace_1"
        repository={{
          id: "repo_1",
          fullName: "test/disposable",
          selected: true,
          archived: false,
        }}
        repositoryConfig={null}
        expectedVersion={version}
        effectiveConfig={openRouterReviewConfiguration()}
        modelOptions={modelOptions}
        mutationsEnabled
      />
    );
    const { rerender } = render(editor(11));
    fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
    expect(
      screen.getByRole("button", { name: "Replace legacy override" }),
    ).toBeTruthy();
    expect(
      new FormData(document.querySelector("form")!).get(
        "policyExpectedVersion",
      ),
    ).toBe("11");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove legacy override (inherit workspace)",
      }),
    );
    expect(clearRepositoryReviewConfigClientAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // A refresh while this confirmation is open must not silently authorize a newer head.
    rerender(editor(12));
    expect(pageText()).toContain(
      "including execution, limits, blocking and rollout settings",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all overrides" }),
    );
    await waitFor(() =>
      expect(clearRepositoryReviewConfigClientAction).toHaveBeenCalledOnce(),
    );
    expect(
      vi
        .mocked(clearRepositoryReviewConfigClientAction)
        .mock.calls[0]![0].get("policyExpectedVersion"),
    ).toBe("11");
  });

  it("preserves the unsaved review language after a failed form action and retries it", async () => {
    vi.mocked(saveWorkspaceReviewConfigClientAction)
      .mockResolvedValueOnce({ params: { error: "review_config_conflict" } })
      .mockResolvedValueOnce({
        params: { notice: "workspace_review_config_saved" },
      });
    render(
      <WorkspaceReviewConfigForm
        workspaceId="workspace_1"
        expectedVersion={1}
        config={openRouterReviewConfiguration()}
        modelOptions={modelOptions}
        mutationsEnabled
      />,
    );
    const language = document.querySelector<HTMLInputElement>(
      'input[name="reviewLanguage"]',
    )!;
    fireEvent.change(language, { target: { value: "Ukrainian" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save workspace default" }),
    );
    await waitFor(() =>
      expect(saveWorkspaceReviewConfigClientAction).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(toast.custom).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          id: expect.stringContaining("danger|Action needs attention|"),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save workspace default" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(language.value).toBe("Ukrainian");
    expect(routerMock.refresh).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save workspace default" }),
    );
    await waitFor(() =>
      expect(saveWorkspaceReviewConfigClientAction).toHaveBeenCalledTimes(2),
    );
    expect(
      vi
        .mocked(saveWorkspaceReviewConfigClientAction)
        .mock.calls[1]![0].get("reviewLanguage"),
    ).toBe("Ukrainian");
  });

  it("reconciles repository form state only when the accepted policy revision changes", () => {
    const config = openRouterReviewConfiguration();
    const props = {
      workspaceId: "workspace_1",
      repository: {
        id: "repo_1",
        fullName: "test/disposable",
        selected: true,
        archived: false,
      },
      repositoryConfig: {
        version: 1,
        policy: { schemaVersion: 3 as const, providers: config.providers },
        config,
      },
      expectedVersion: 1,
      effectiveConfig: config,
      modelOptions,
      mutationsEnabled: true,
    };
    const { rerender } = render(<RepositoryPolicyEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
    fireEvent.change(
      document.querySelector('select[name="policyMode.providers"]')!,
      { target: { value: "inherit" } },
    );
    rerender(<RepositoryPolicyEditor {...props} />);
    expect(providersMode()).toBe("inherit");
    rerender(
      <RepositoryPolicyEditor
        {...props}
        expectedVersion={2}
        repositoryConfig={{ ...props.repositoryConfig, version: 2 }}
      />,
    );
    expect(providersMode()).toBe("override");
  });

  // Regression: refreshed choices must not replace a saved tuple or admit stale selections.
  it.each([
    "disabled",
    "revoked",
    "unbound",
    "fence",
    "wrong-profile",
    "stale-model",
    "denied",
    "unavailable",
    "pagination",
  ])("preserves selection and blocks save after %s refresh", (condition) => {
    const provider = {
      ...workspacePolicy.providers[0]!,
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2-pro",
    } satisfies ReviewProviderConfiguration;
    const props = {
      action: vi.fn(),
      config: {
        ...workspacePolicy,
        providers: [provider],
      },
      modelOptions,
      hiddenFields: [{ name: "workspaceId", value: "workspace_1" }],
      mutationsEnabled: true,
      submitLabel: "Save",
    };
    const { rerender } = render(
      <ReviewConfigForm
        {...props}
        gatewayAccounts={{ status: "ok", value: gatewayPage }}
      />,
    );
    const account: AccountView = {
      ...gatewayPage.accounts[0]!,
      binding: { ...gatewayPage.accounts[0]!.binding! },
    };
    if (condition === "disabled") account.state = "disabled";
    if (condition === "revoked") account.binding!.state = "revoked";
    if (condition === "unbound") account.binding = null;
    if (condition === "fence") account.binding!.fencePending = true;
    if (condition === "wrong-profile") account.profileId = "profile-codex";
    const page: AccountsResult<AccountsPage> =
      condition === "denied" || condition === "unavailable"
        ? { status: condition }
        : {
            status: "ok",
            value: {
              ...gatewayPage,
              profiles: gatewayPage.profiles.map((profile) => ({
                ...profile,
                models:
                  condition === "stale-model"
                    ? profile.models.filter((model) => model !== provider.model)
                    : profile.models,
              })),
              accounts:
                condition === "pagination"
                  ? [gatewayPage.accounts[1]!]
                  : [account, gatewayPage.accounts[1]!],
              nextCursor: condition === "pagination" ? "next-page" : null,
            },
          };
    rerender(<ReviewConfigForm {...props} gatewayAccounts={page} />);
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
    const form = document.querySelector("form")!;
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0]!,
    ).toEqual(provider);
    fireEvent.submit(form);
    expect(props.action).not.toHaveBeenCalled();
    expect(pageText()).toContain(
      "Choose an available account and model before saving",
    );
    if (condition !== "stale-model") {
      expect(pageText()).toContain(
        "choose the available account again and save",
      );
      expect(
        screen
          .getByRole("link", { name: "Open Accounts" })
          .getAttribute("href"),
      ).toBe(
        "/dashboard/setup?workspace=workspace_1#dashboard-section-content",
      );
    }
    if (condition === "pagination")
      expect(pageText()).toContain("Additional accounts are not available");
    if (condition === "denied" || condition === "unavailable") {
      fireEvent.click(
        screen.getByRole("combobox", {
          name: "Connection method",
        }),
      );
      expect(
        screen
          .getByRole("option", { name: /ReviewRouter \/ sub2api/ })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    }
  });

  it("waits for the exact off-page account read before offering unavailable-account recovery", async () => {
    type Detail = Awaited<ReturnType<GatewayModelAccountsApi["get"]>>;
    let resolveDetail!: (value: Detail) => void;
    const detail = new Promise<Detail>((resolve) => {
      resolveDetail = resolve;
    });
    const api = {
      list: vi.fn<GatewayModelAccountsApi["list"]>(),
      get: vi.fn<GatewayModelAccountsApi["get"]>().mockReturnValue(detail),
    };
    const provider = {
      ...workspacePolicy.providers[0]!,
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2-pro",
    } satisfies ReviewProviderConfiguration;
    render(
      <GatewayModelAccountsProvider scope="org-x" api={api}>
        <ReviewConfigForm
          action={vi.fn()}
          config={{ ...workspacePolicy, providers: [provider] }}
          gatewayAccounts={{
            status: "ok",
            value: { ...gatewayPage, accounts: [] },
          }}
          modelOptions={modelOptions}
          hiddenFields={[]}
          mutationsEnabled
          submitLabel="Save"
        />
      </GatewayModelAccountsProvider>,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("binding-mimo"));
    expect(screen.queryByRole("link", { name: "Open Accounts" })).toBeNull();
    await act(async () => resolveDetail({ status: "denied" }));
    expect(
      await screen.findByRole("link", { name: "Open Accounts" }),
    ).toBeTruthy();
    expect(
      readReviewConfigurationForm(new FormData(document.querySelector("form")!))
        .providers[0],
    ).toEqual(provider);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.list).not.toHaveBeenCalled();
  });

  it("preserves saved gateway model whitespace and ultra effort and offers max and ultra", () => {
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      model: "openai/gpt-5.6-sol ",
      reasoningEffort: "ultra",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
    } satisfies ReviewProviderConfiguration;
    renderReviewConfigForm({
      config: {
        ...workspacePolicy,
        providers: [provider],
      },
      repositoryFullName: "test/disposable-gateway",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    const serialized = readReviewConfigurationForm(new FormData(form!));
    const normalized = { ...provider, model: provider.model.trim() };
    expect(serialized.providers[0]!).toEqual(normalized);
    expect(serialized.providers).toEqual([normalized]);
    choose("Model", /^mimo-v2-pro$/);
    expect(
      readReviewConfigurationForm(new FormData(form!)).providers[0]!
        .reasoningEffort,
    ).toBe("ultra");

    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
    expect(screen.getByRole("option", { name: /Max/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ultra/ })).toBeTruthy();
    expect(checkProviderRepositorySecretClientAction).not.toHaveBeenCalled();
  });

  it("round-trips a saved gateway selection without a GitHub secret probe and clears refs when switching auth", () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      model: "mimo-v2-pro",
      reasoningEffort: "xhigh",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
    } satisfies ReviewProviderConfiguration;
    renderReviewConfigForm({
      config: {
        ...workspacePolicy,
        providers: [provider],
      },
      repositoryFullName: "test/disposable-gateway",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    expect(
      readReviewConfigurationForm(new FormData(form!)).providers[0]!,
    ).toMatchObject({
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
    });
    expect(checkProviderRepositorySecretClientAction).not.toHaveBeenCalled();
    expect(pageText()).toContain("Credentials stay on the server");
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Connection method",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: /GitHub Secrets/ }));
    choose("Provider", /^OpenRouter$/);
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), {
      target: { value: "openai/gpt-5.6-sol" },
    });
    const switched = readReviewConfigurationForm(new FormData(form!))
      .providers[0]!;
    expect(switched.authMode).toBe("openrouter_api_key");
    expect(switched.gatewayBindingId).toBeUndefined();
    expect(switched.gatewayProfileRef).toBeUndefined();
  });

  it("shows the account pool as the account authentication storage for gateway providers", () => {
    const provider = {
      ...workspacePolicy.providers[0]!,
      kind: "codex" as const,
      authMode: "codex_account_gateway" as const,
      gatewayBindingId: "binding-mimo",
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2-pro",
    };
    renderReviewConfigForm({
      config: { ...workspacePolicy, providers: [provider] },
    });
    expect(
      screen.getByRole("combobox", {
        name: "Connection method",
      }).textContent,
    ).toContain("ReviewRouter / sub2api (encrypted)");
    expect(
      screen.queryByRole("combobox", { name: "Provider auth" }),
    ).toBeNull();
    expect(
      new FormData(document.querySelector("form")!).get("providerAuthMode.0"),
    ).toBe("codex_account_gateway");
  });

  it("offers only the default review agent profile and saves no engine selection", () => {
    renderReviewConfigForm({
      config: { ...workspacePolicy, providers: [gatewayProviderFixture()] },
    });
    const profileSelect = screen.getByRole("combobox", {
      name: "Review agent profile",
    });
    expect(profileSelect.textContent).toContain("Default (OpenCodeReview)");
    fireEvent.click(profileSelect);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent ?? ""),
    ).toEqual([expect.stringContaining("Default (OpenCodeReview)")]);
    const form = document.querySelector("form")!;
    expect(new FormData(form).get("providerAgentProfileRef.0")).toBe("");
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0]!
        .agentProfileRef,
    ).toBeUndefined();
  });

  it("explains the engine when changing authentication or selecting supplied-diff-only", () => {
    renderReviewConfigForm({
      config: { ...workspacePolicy, providers: [gatewayProviderFixture()] },
    });
    expect(
      screen.queryByText(/Uses the built-in ReviewRouter engine/),
    ).toBeNull();
    choose("Connection method", /GitHub/);
    expect(
      screen.getByText(/To use OpenCodeReview, choose Account Gateway/),
    ).toBeTruthy();
    choose("Connection method", /ReviewRouter \/ sub2api/);
    expect(
      screen.queryByText(/Uses the built-in ReviewRouter engine/),
    ).toBeNull();
    choose("Agentic context", /Disabled/);
    expect(
      screen.getByText(/To use OpenCodeReview, enable Agentic context/),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Review agent profile" })
        .textContent,
    ).toContain("Default (ReviewRouter)");
  });

  it("saves an explicitly selected approved review agent profile", () => {
    renderReviewConfigForm({
      config: { ...workspacePolicy, providers: [gatewayProviderFixture()] },
      agentProfileOptions: [ocrAgentProfileOption],
    });
    expect(
      screen.getByRole("combobox", { name: "Review agent profile" })
        .textContent,
    ).toContain("Default (OpenCodeReview)");
    choose("Review agent profile", /ocr-prod-1/);
    const form = document.querySelector("form")!;
    expect(new FormData(form).get("providerAgentProfileRef.0")).toBe(
      "ocr-prod-1",
    );
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0]!
        .agentProfileRef,
    ).toBe("ocr-prod-1");
  });

  it("explains the incompatibility and blocks saving an OCR profile without agentic context", () => {
    renderReviewConfigForm({
      config: {
        ...workspacePolicy,
        providers: [{ ...gatewayProviderFixture(), agenticContext: false }],
      },
      agentProfileOptions: [ocrAgentProfileOption],
    });
    choose("Review agent profile", /ocr-prod-1/);
    expect(
      screen.getByText(/native context tools and needs Agentic context/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Set Agentic context to Enabled before saving/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save workspace default" })
        .hasAttribute("disabled"),
    ).toBe(true);
    choose("Agentic context", /Enabled/);
    expect(
      screen.queryByText(/Set Agentic context to Enabled before saving/),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Save workspace default" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers account pool first in the storage choice and switches a secret provider to it", () => {
    renderReviewConfigForm({
      config: {
        ...workspacePolicy,
        providers: [
          {
            ...workspacePolicy.providers[0]!,
            authMode: "mimo_token_plan_api_key",
            gatewayBindingId: undefined,
            gatewayProfileRef: undefined,
            agentProfileRef: undefined,
          },
        ],
      },
    });
    const storage = screen.getByRole("combobox", {
      name: "Connection method",
    });
    expect(storage.textContent).toContain("GitHub Secrets");
    fireEvent.click(storage);
    const optionLabels = screen
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    expect(optionLabels[0]).toContain("ReviewRouter / sub2api (encrypted)");
    expect(optionLabels[1]).toContain("GitHub Secrets");
    fireEvent.click(
      screen.getByRole("option", { name: /ReviewRouter \/ sub2api/ }),
    );
    expect(
      new FormData(document.querySelector("form")!).get("providerAuthMode.0"),
    ).toBe("codex_account_gateway");
    expect(
      screen.queryByRole("combobox", { name: "Provider auth" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", {
        name: "Connection method",
      }).textContent,
    ).toContain("ReviewRouter / sub2api (encrypted)");
  });

  // Regression: ambiguous Gateway accounts used to erase the selected vendor,
  // and switching back to Secrets could silently become another provider.
  it("keeps OpenRouter across both connection methods and filters accounts by configured provider", () => {
    const profile = {
      id: "profile-openrouter",
      label: "OpenRouter",
      provider: "openrouter" as const,
      protocol: "openai-responses" as const,
      models: ["openai/gpt-5.6-sol"],
    };
    const accounts = ["a", "b"].map((id) => ({
      ...gatewayPage.accounts[0]!,
      label: `OpenRouter ${id}`,
      profileId: profile.id,
      binding: {
        ...gatewayPage.accounts[0]!.binding!,
        id: `binding-openrouter-${id}`,
      },
    }));
    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      gatewayAccounts: {
        status: "ok",
        value: {
          profiles: [...gatewayPage.profiles, profile],
          accounts: [
            ...accounts,
            { ...gatewayPage.accounts[1]!, label: "OpenRouter spoofed label" },
          ],
          nextCursor: null,
        },
      },
    });
    const form = document.querySelector("form")!;
    const submit = screen.getByRole("button", {
      name: "Save workspace default",
    });
    choose("Connection method", /ReviewRouter \/ sub2api/);
    expect(screen.getByRole("combobox", { name: "Provider" }).textContent).toBe(
      "OpenRouter",
    );
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("combobox", { name: "Account" }));
    expect(screen.queryByRole("option", { name: /spoofed label/ })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /^OpenRouter a/ }));
    choose("Model", /^openai\/gpt-5.6-sol$/);
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0],
    ).toMatchObject({
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding-openrouter-a",
      gatewayProfileRef: profile.id,
      model: "openai/gpt-5.6-sol",
    });
    expect(submit.hasAttribute("disabled")).toBe(false);
    choose("Connection method", /GitHub Secrets/);
    expect(screen.getByRole("combobox", { name: "Provider" }).textContent).toBe(
      "OpenRouter",
    );
    expect(new FormData(form).get("providerAuthMode.0")).toBe(
      "openrouter_api_key",
    );
    expect(
      (screen.getByRole("textbox", { name: "Model" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), {
      target: { value: "openai/gpt-5.6-sol" },
    });
    const direct = readReviewConfigurationForm(new FormData(form))
      .providers[0]!;
    expect(direct.kind).toBe("openrouter");
    expect(direct.gatewayBindingId).toBeUndefined();
    expect(direct.gatewayProfileRef).toBeUndefined();
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("clears a Gateway tuple on provider change and explains unsupported Claude Gateway", () => {
    renderReviewConfigForm({
      config: { ...workspacePolicy, providers: [gatewayProviderFixture()] },
    });
    choose("Provider", /Anthropic \/ Claude/);
    const form = document.querySelector("form")!;
    expect(new FormData(form).get("providerGatewayBindingId.0")).toBe("");
    expect(new FormData(form).get("providerGatewayProfileRef.0")).toBe("");
    expect(new FormData(form).get("providerModel.0")).toBe("");
    expect(pageText()).toContain(
      "Anthropic / Claude is not supported by the current ReviewRouter Gateway protocol",
    );
    expect(
      screen
        .getByRole("combobox", { name: "Account" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Save workspace default" })
        .hasAttribute("disabled"),
    ).toBe(true);
    choose("Connection method", /GitHub Secrets/);
    expect(new FormData(form).get("providerAuthMode.0")).toBe(
      "claude_code_oauth",
    );
    expect(screen.getByRole("combobox", { name: "Provider" }).textContent).toBe(
      "Anthropic / Claude",
    );
  });

  it.each([false, true])(
    "preserves unknown saved Gateway provider metadata and respects inherited=%s",
    (inherited) => {
      const provider = gatewayProviderFixture();
      const action = vi.fn();
      render(
        <ReviewConfigForm
          action={action}
          config={{ ...workspacePolicy, providers: [provider] }}
          {...(inherited
            ? { repositoryPolicy: { schemaVersion: 3 as const } }
            : {})}
          modelOptions={modelOptions}
          gatewayAccounts={{
            status: "ok",
            value: {
              ...gatewayPage,
              profiles: gatewayPage.profiles.map((profile) => ({
                id: profile.id,
                label: profile.label,
                protocol: profile.protocol,
                models: profile.models,
              })),
            },
          }}
          hiddenFields={[]}
          mutationsEnabled={true}
          submitLabel="Save"
        />,
      );
      const form = document.querySelector("form")!;
      expect(
        screen.getByRole("combobox", { name: "Provider" }).textContent,
      ).toContain("Selected provider unavailable");
      expect(new FormData(form).get("providerGatewayBindingId.0")).toBe(
        "binding-mimo",
      );
      expect(new FormData(form).get("providerModel.0")).toBe("mimo-v2-pro");
      expect(
        screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
      ).toBe(!inherited);
      if (!inherited) {
        fireEvent.submit(form);
        expect(action).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps explicit vendor choices on their rows when removing an earlier provider", () => {
    const config = duplicateOpenRouterReviewConfiguration();
    renderReviewConfigForm({
      config: {
        ...config,
        providers: [
          ...config.providers,
          { ...config.providers[0]!, model: "another-model" },
        ],
      },
    });
    fireEvent.click(screen.getAllByRole("combobox", { name: "Provider" })[2]!);
    fireEvent.click(screen.getByRole("option", { name: /^MiMo$/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    const selects = screen.getAllByRole("combobox", { name: "Provider" });
    expect(selects.map((select) => select.textContent)).toEqual([
      "OpenRouter",
      "MiMo",
    ]);
    expect(
      new FormData(document.querySelector("form")!).get("providerAuthMode.1"),
    ).toBe("mimo_token_plan_api_key");
  });

  it("preserves configured investigation rollout values in dashboard submissions", () => {
    renderReviewConfigForm({
      config: {
        ...workspacePolicy,
        investigationRollout: {
          recordingEnabled: true,
          shadowEnabled: true,
          contextCriticEnabled: true,
          verifiedCleanEnabled: true,
          crossRevisionReplayEnabled: true,
          productionEffectsEnabled: true,
        },
      },
    });

    for (const flag of [
      "recordingEnabled",
      "shadowEnabled",
      "contextCriticEnabled",
      "verifiedCleanEnabled",
      "crossRevisionReplayEnabled",
      "productionEffectsEnabled",
    ]) {
      expect(
        (
          document.querySelector(
            `input[name="investigationRollout.${flag}"]`,
          ) as HTMLInputElement
        ).value,
      ).toBe("true");
    }
  });

  it("keeps at least one provider and adds an OpenRouter provider", () => {
    renderReviewConfigForm({ config: openRouterReviewConfiguration() });

    expect(
      (screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    expect(screen.getByText("Provider 2")).toBeTruthy();
    expect(
      screen.getAllByRole("combobox", { name: "Provider auth" }),
    ).toHaveLength(2);
    expect(
      (screen.getAllByRole("textbox", { name: "Model" })[1] as HTMLInputElement)
        .value,
    ).toBe("poolside/laguna-m.1:free");
    expect(
      (
        screen.getAllByRole("checkbox", {
          name: "Required healthy",
        })[0] as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getAllByRole("checkbox", {
          name: "Required healthy",
        })[1] as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(screen.getAllByText("FREE RECOMMENDED").length).toBeGreaterThan(0);
    expect(
      (
        screen.getAllByRole("button", {
          name: "Remove",
        })[1] as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("keeps one provider marked as required healthy", () => {
    renderReviewConfigForm({ config: openRouterReviewConfiguration() });

    const requiredToggle = screen.getByRole("checkbox", {
      name: "Required healthy",
    }) as HTMLInputElement;

    expect(requiredToggle.checked).toBe(true);
    fireEvent.click(requiredToggle);
    expect(requiredToggle.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    expect(
      (
        screen.getByRole("checkbox", {
          name: "Required healthy",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("filters model options by selected provider", () => {
    renderReviewConfigForm();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open model options" })[0]!,
    );

    expect(screen.getByRole("option", { name: /gpt-5\.6-sol/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Poolside/ })).toBeNull();
  });

  it("allows paid model options when they match the typed search", () => {
    renderReviewConfigForm({ config: openRouterReviewConfiguration() });

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    const modelInput = screen.getAllByRole("textbox", {
      name: "Model",
    })[1] as HTMLInputElement;
    modelInput.focus();
    fireEvent.change(modelInput, { target: { value: "anthropic" } });

    const listbox = screen.getByRole("listbox");
    const paidOption = within(listbox).getByRole("option", {
      name: /Anthropic: Claude/,
    });
    expect(paidOption).toHaveProperty("disabled", false);
    expect(
      within(listbox).queryByRole("option", { name: /Poolside/ }),
    ).toBeNull();

    fireEvent.click(paidOption);
    expect(
      (screen.getAllByRole("textbox", { name: "Model" })[1] as HTMLInputElement)
        .value,
    ).toBe("anthropic/claude-sonnet-4.5");
  });

  it("filters model options by typed model text while keeping custom input", () => {
    renderReviewConfigForm({ config: openRouterReviewConfiguration() });

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    const modelInput = screen.getAllByRole("textbox", {
      name: "Model",
    })[1] as HTMLInputElement;
    modelInput.focus();
    fireEvent.change(modelInput, { target: { value: "anthropic" } });

    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox).getByRole("option", { name: /Anthropic: Claude/ }),
    ).toBeTruthy();
    expect(
      within(listbox).queryByRole("option", { name: /Poolside/ }),
    ).toBeNull();

    fireEvent.change(modelInput, { target: { value: "custom/new-model" } });

    expect(modelInput.value).toBe("custom/new-model");
    expect(screen.getByText(/custom model value will be saved/i)).toBeTruthy();
  });

  it("allows custom model text", () => {
    renderReviewConfigForm();

    const modelInput = screen.getByRole("textbox", {
      name: "Model",
    }) as HTMLInputElement;
    modelInput.focus();
    fireEvent.change(modelInput, { target: { value: "custom/model-1" } });

    const updatedModelInput = screen.getByRole("textbox", {
      name: "Model",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(updatedModelInput);

    fireEvent.change(updatedModelInput, {
      target: { value: "custom/model-123" },
    });

    expect(updatedModelInput.value).toBe("custom/model-123");
  });

  it("shows a green OpenRouter secret status when the repository secret exists", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "available_repository",
    });

    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status.textContent).toContain(
        "OPENROUTER_API_KEY is set in this repository's GitHub Actions secrets",
      );
    });
    expect(screen.queryByText(/OpenRouter requires/i)).toBeNull();
  });

  it("derives rotating Codex readiness from the exact versioned activation chain", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "available_repository",
    });

    renderReviewConfigForm({
      config: codexReviewConfiguration("codex_subscription_oauth_rotating"),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status.textContent).toContain(
        "Authorized versioned Codex setup is active for this repository",
      );
      expect(status.textContent).toContain(
        "Readiness comes from the confirmed versioned claim and namespace activation chain",
      );
      expect(status.textContent).not.toContain("REVIEWROUTER_CODEX_AUTH_JSON");
      expect(status.textContent).not.toContain("can use this secret in CI");
    });
  });

  it("never offers a generic stable-secret fallback for rotating Codex", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });

    renderReviewConfigForm({
      config: codexReviewConfiguration("codex_subscription_oauth_rotating"),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    expect(
      await screen.findByText(
        /Rotating Codex setup is not ready for this repository/i,
      ),
    ).toBeTruthy();
    expect(pageText()).toContain(
      "A generic repository secret cannot satisfy this readiness check",
    );
    expect(pageText()).not.toContain("REVIEWROUTER_CODEX_AUTH_JSON");
    expect(pageText()).not.toContain("gh secret set");
  });

  it("submits the saved rotating Codex auth mode when rotating is disabled for this surface", () => {
    renderReviewConfigForm({
      config: workspacePolicy,
      codexRotatingOAuthEnabled: false,
    });

    const form = document.querySelector("form")!;
    expect(
      readReviewConfigurationForm(new FormData(form)).providers[0]!.authMode,
    ).toBe("codex_subscription_oauth_rotating");
    expect(
      screen.getByRole("combobox", { name: "Provider auth" }).textContent,
    ).toContain("Codex OAuth with refresh");
  });

  it.each(["codex_subscription_oauth", "codex_openai_api_key"] as const)(
    "migrates legacy Codex auth mode %s to rotating OAuth in the form",
    async (authMode) => {
      vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
        status: "missing",
      });

      renderReviewConfigForm({
        config: codexReviewConfiguration(authMode),
        repositoryFullName: "777genius/agent-teams-ai",
        repositorySecretCheckTarget: {
          workspaceId: "workspace_1",
          repositoryId: "repo_1",
        },
      });

      await waitFor(() => {
        expect(
          screen.getByText(/Rotating Codex setup is not ready/i),
        ).toBeTruthy();
      });
      expect(
        screen.getByText(/Legacy Codex setup requires reconnect/i),
      ).toBeTruthy();
      expect(pageText()).toContain("server-authorized versioned namespace");
      expect(pageText()).not.toContain("REVIEWROUTER_CODEX_AUTH_JSON");
      expect(pageText()).not.toContain("gh secret set");
      expect(pageText()).not.toContain("gh secret set CODEX_AUTH_JSON");
      expect(pageText()).not.toContain("OPENAI_API_KEY");
      const formData = vi.mocked(checkProviderRepositorySecretClientAction).mock
        .calls[0]?.[0] as FormData;
      expect(formData.get("providerKind")).toBe("codex");
      expect(formData.get("authMode")).toBe(
        "codex_subscription_oauth_rotating",
      );
    },
  );

  it("preserves inherited legacy Codex hybrid config as rotating Codex plus other providers", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });

    renderReviewConfigForm({
      config: legacyCodexMultiProviderReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Rotating Codex setup is not ready/i),
      ).toBeTruthy();
    });
    expect(screen.getByText("Provider 1")).toBeTruthy();
    expect(screen.getByText("Provider 2")).toBeTruthy();
    expect(screen.getByText("Provider 3")).toBeTruthy();
    expect(
      (
        document.querySelector(
          'input[name="providerCount"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(
      (
        screen.getByRole("button", {
          name: "Add provider",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    const formData = vi.mocked(checkProviderRepositorySecretClientAction).mock
      .calls[0]?.[0] as FormData;
    expect(formData.get("providerKind")).toBe("codex");
    expect(formData.get("authMode")).toBe("codex_subscription_oauth_rotating");
  });

  it("switching one provider to Codex rotating keeps other providers and blocks a second rotating Codex", () => {
    renderReviewConfigForm({
      config: duplicateOpenRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
    });

    expect(screen.getByText("Provider 2")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("combobox", { name: "Provider" })[0]!);
    fireEvent.click(screen.getByRole("option", { name: /OpenAI \/ Codex/ }));

    expect(screen.getByText("Provider 2")).toBeTruthy();
    expect(
      (
        document.querySelector(
          'input[name="providerCount"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("2");
    expect(
      (
        screen.getByRole("button", {
          name: "Add provider",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    fireEvent.click(screen.getAllByRole("combobox", { name: "Provider" })[1]!);
    fireEvent.click(screen.getByRole("option", { name: /OpenAI \/ Codex/ }));
    fireEvent.click(
      screen.getAllByRole("combobox", { name: "Provider auth" })[1]!,
    );
    expect(
      screen
        .getByRole("option", { name: /Only one Codex OAuth with refresh/i })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("selects the MiMo model and shows the repository-specific interactive secret command", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });
    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    choose("Provider", /^MiMo$/);
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), {
      target: { value: "mimo-v2.6-pro" },
    });

    expect(
      (screen.getByRole("textbox", { name: "Model" }) as HTMLInputElement)
        .value,
    ).toBe("mimo-v2.6-pro");
    expect(
      await screen.findByText(
        "gh secret set MIMO_TOKEN_PLAN_API_KEY --repo 777genius/agent-teams-ai --app actions",
      ),
    ).toBeTruthy();
    expect(pageText()).toContain(
      "Without this secret, this provider will fail in CI.",
    );
  });

  it("offers Claude explicitly, explains unavailable workspace auth, and hides Codex controls", () => {
    renderReviewConfigForm({ claudeCodeProviderEnabled: false });
    choose("Provider", /Anthropic \/ Claude/);
    expect(pageText()).toContain(
      "GitHub Secrets is unavailable for this provider",
    );
    expect(
      screen
        .getByRole("button", { name: "Save workspace default" })
        .hasAttribute("disabled"),
    ).toBe(true);

    cleanup();
    renderReviewConfigForm();
    choose("Provider", /Anthropic \/ Claude/);
    expect(
      screen.getByRole("combobox", { name: "Provider auth" }).textContent,
    ).toContain("Claude Code subscription");
    expect(
      (screen.getByRole("textbox", { name: "Model" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(screen.queryByText("Reasoning effort")).toBeNull();
    expect(screen.queryByText("Fast mode")).toBeNull();
    expect(screen.queryByText("Agentic context")).toBeNull();
  });

  it("shows only the production Codex OAuth mode", () => {
    renderReviewConfigForm();
    fireEvent.click(screen.getByRole("combobox", { name: "Provider auth" }));
    expect(
      screen.getByRole("option", { name: /Codex OAuth with refresh/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: /Codex legacy OAuth/i }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: /Codex API key/i })).toBeNull();
  });

  it("offers max and ultra reasoning effort for Codex", () => {
    renderReviewConfigForm();

    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));

    expect(screen.getByRole("option", { name: /Max/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ultra/ })).toBeTruthy();
  });

  it("hides max and ultra for an older Codex model", () => {
    renderReviewConfigForm({
      config: codexReviewConfiguration("codex_subscription_oauth_rotating"),
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));

    expect(screen.queryByRole("option", { name: /Max/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Ultra/ })).toBeNull();
    expect(screen.getByRole("option", { name: /XHigh/ })).toBeTruthy();
  });

  it("clamps ultra to xhigh when the model changes away from gpt-5.6-sol", () => {
    renderReviewConfigForm();

    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
    fireEvent.click(screen.getByRole("option", { name: /Ultra/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), {
      target: { value: "gpt-5.5" },
    });

    expect(
      screen.getByRole("combobox", { name: "Reasoning effort" }).textContent,
    ).toContain("XHigh");
  });

  it("checks the Claude Code OAuth secret for a saved Claude provider", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });

    renderReviewConfigForm({
      config: claudeReviewConfiguration(),
      claudeCodeProviderEnabled: false,
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          /Claude Code subscription mode uses CLAUDE_CODE_OAUTH_TOKEN/i,
        ),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        "gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo 777genius/agent-teams-ai --app actions",
      ),
    ).toBeTruthy();
    const formData = vi.mocked(checkProviderRepositorySecretClientAction).mock
      .calls[0]?.[0] as FormData;
    expect(formData.get("providerKind")).toBe("claude");
    expect(formData.get("authMode")).toBe("claude_code_oauth");
  });

  it("shows a loader instead of a setup warning while secret status is loading", () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockReturnValue(
      new Promise(() => undefined),
    );

    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    expect(
      screen.getByText(/Checking GitHub Actions secret metadata/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Set a repository secret/i)).toBeNull();
  });

  it("refreshes provider secret status on demand", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction)
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce({ status: "available_repository" });

    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await screen.findByText(/OpenRouter providers use OPENROUTER_API_KEY/i);

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh secret status" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "OPENROUTER_API_KEY is set in this repository's GitHub Actions secrets",
      );
    });
    expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(2);
  });

  it("keeps the setup warning when OpenRouter secret metadata is missing", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "missing",
    });

    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/OpenRouter providers use OPENROUTER_API_KEY/i),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        "gh secret set OPENROUTER_API_KEY --repo 777genius/agent-teams-ai",
      ),
    ).toBeTruthy();
  });

  it("checks a shared provider secret only once for duplicate auth modes", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "available_repository",
    });

    renderReviewConfigForm({
      config: duplicateOpenRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "OPENROUTER_API_KEY is set in this repository's GitHub Actions secrets",
      );
    });
    expect(
      screen.getByText(
        "Checked once for 2 providers using OpenRouter API key.",
      ),
    ).toBeTruthy();
    expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(1);
  });

  it("does not mount repository override secret checks until the row is opened", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "available_repository",
    });

    renderRepositoryPolicyOverrideDetails({
      repositoryConfig: {
        policy: { schemaVersion: 3 },
        version: 6,
        config: duplicateOpenRouterReviewConfiguration(),
      },
    });

    expect(screen.getByText("777genius/agent-teams-ai")).toBeTruthy();
    expect(screen.queryByText("Provider 1")).toBeNull();
    expect(checkProviderRepositorySecretClientAction).not.toHaveBeenCalled();

    const rowButton = screen
      .getByText("777genius/agent-teams-ai")
      .closest("button");
    expect(rowButton).not.toBeNull();
    fireEvent.click(rowButton!);

    expect(screen.getByText("Provider 1")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("status")
          .find((status) =>
            status.textContent?.includes(
              "OPENROUTER_API_KEY is set in this repository's GitHub Actions secrets",
            ),
          ),
      ).toBeTruthy();
    });
    expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(1);

    fireEvent.click(rowButton!);
    expect(screen.queryByText("Provider 1")).toBeNull();
    fireEvent.click(rowButton!);

    await waitFor(() => {
      expect(
        screen
          .getAllByRole("status")
          .find((status) =>
            status.textContent?.includes(
              "OPENROUTER_API_KEY is set in this repository's GitHub Actions secrets",
            ),
          ),
      ).toBeTruthy();
    });
    expect(checkProviderRepositorySecretClientAction).toHaveBeenCalledTimes(1);
  });

  it("explains when an organization OpenRouter secret is not selected for this repository", async () => {
    vi.mocked(checkProviderRepositorySecretClientAction).mockResolvedValue({
      status: "not_available_to_repository",
    });

    renderReviewConfigForm({
      config: openRouterReviewConfiguration(),
      repositoryFullName: "777genius/agent-teams-ai",
      repositorySecretCheckTarget: {
        workspaceId: "workspace_1",
        repositoryId: "repo_1",
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/not selected for access/i)).toBeTruthy();
    });
    expect(screen.getByText(/Repository access/i)).toBeTruthy();
    expect(
      screen.getByText(
        "gh secret set OPENROUTER_API_KEY --repo 777genius/agent-teams-ai",
      ),
    ).toBeTruthy();
  });
});

function addOverrideField(label: string | RegExp): void {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "+ Add field to override" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

function providersMode(): string | undefined {
  return (
    document.querySelector<HTMLSelectElement>(
      'select[name="policyMode.providers"]',
    )?.value ??
    document.querySelector<HTMLInputElement>(
      'input[name="policyMode.providers"]',
    )?.value
  );
}

function renderReviewConfigForm(input?: {
  readonly config?: ReviewConfiguration;
  readonly gatewayAccounts?: AccountsResult<AccountsPage>;
  readonly repositoryFullName?: string;
  readonly codexRotatingOAuthEnabled?: boolean;
  readonly claudeCodeProviderEnabled?: boolean;
  readonly agentProfileOptions?: readonly GatewayAgentProfileOption[];
  readonly repositorySecretCheckTarget?: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  };
}): void {
  render(
    <ReviewConfigForm
      action={() => undefined}
      config={input?.config ?? workspacePolicy}
      modelOptions={modelOptions}
      gatewayAccounts={
        input?.gatewayAccounts ?? { status: "ok", value: gatewayPage }
      }
      agentProfileOptions={input?.agentProfileOptions}
      codexRotatingOAuthEnabled={input?.codexRotatingOAuthEnabled ?? true}
      claudeCodeProviderEnabled={input?.claudeCodeProviderEnabled ?? true}
      hiddenFields={[{ name: "workspaceId", value: "workspace_1" }]}
      mutationsEnabled={true}
      submitLabel="Save workspace default"
      repositoryFullName={input?.repositoryFullName}
      repositorySecretCheckTarget={input?.repositorySecretCheckTarget}
    />,
  );
}

function renderRepositoryPolicyOverrideDetails(input?: {
  readonly repositoryConfig?: {
    readonly policy: { readonly schemaVersion: 3 };
    readonly version: number;
    readonly config: ReviewConfiguration;
  } | null;
}): void {
  const repositoryConfig = input?.repositoryConfig ?? null;
  render(
    <RepositoryPolicyOverrideDetails
      workspaceId="workspace_1"
      repository={{
        id: "repo_1",
        fullName: "777genius/agent-teams-ai",
        selected: true,
        archived: false,
      }}
      repositoryConfig={repositoryConfig}
      effectiveConfig={
        repositoryConfig?.config ?? duplicateOpenRouterReviewConfiguration()
      }
      configVersion={repositoryConfig?.version ?? 6}
      modelOptions={modelOptions}
      mutationsEnabled={true}
    />,
  );
}

function openRouterReviewConfiguration(): ReviewConfiguration {
  const openRouterProvider: ReviewProviderConfiguration = {
    kind: "openrouter",
    authMode: "openrouter_api_key",
    model: "poolside/laguna-m.1:free",
    reasoningEffort: "medium",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  };

  return {
    ...workspacePolicy,

    providers: [openRouterProvider],
  };
}

function duplicateOpenRouterReviewConfiguration(): ReviewConfiguration {
  const firstOpenRouterProvider: ReviewProviderConfiguration = {
    kind: "openrouter",
    authMode: "openrouter_api_key",
    model: "poolside/laguna-m.1:free",
    reasoningEffort: "medium",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  };
  const secondOpenRouterProvider: ReviewProviderConfiguration = {
    ...firstOpenRouterProvider,
    model: "anthropic/claude-sonnet-4.5",
    requiredHealthy: false,
  };

  return {
    ...workspacePolicy,

    providers: [firstOpenRouterProvider, secondOpenRouterProvider],
    execution: { ...workspacePolicy.execution, providerLimit: 2 },
  };
}

function legacyCodexMultiProviderReviewConfiguration(): ReviewConfiguration {
  const codexProvider: ReviewProviderConfiguration = {
    kind: "codex",
    authMode: "codex_subscription_oauth",
    model: "gpt-5.5",
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  };
  const firstOpenRouterProvider: ReviewProviderConfiguration = {
    kind: "openrouter",
    authMode: "openrouter_api_key",
    model: "poolside/laguna-m.1:free",
    reasoningEffort: "medium",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: false,
  };
  const secondOpenRouterProvider: ReviewProviderConfiguration = {
    ...firstOpenRouterProvider,
    model: "anthropic/claude-sonnet-4.5",
  };

  return {
    ...workspacePolicy,

    providers: [
      codexProvider,
      firstOpenRouterProvider,
      secondOpenRouterProvider,
    ],
    execution: {
      ...workspacePolicy.execution,
      providerLimit: 3,
      providerMaxParallel: 2,
    },
  };
}

function codexReviewConfiguration(
  authMode:
    | "codex_subscription_oauth"
    | "codex_subscription_oauth_rotating"
    | "codex_openai_api_key",
): ReviewConfiguration {
  const codexProvider: ReviewProviderConfiguration = {
    kind: "codex",
    authMode,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  };

  return {
    ...workspacePolicy,

    providers: [codexProvider],
  };
}

function claudeReviewConfiguration(): ReviewConfiguration {
  const claudeProvider: ReviewProviderConfiguration = {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    reasoningEffort: "medium",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  };

  return {
    ...workspacePolicy,

    providers: [claudeProvider],
  };
}
