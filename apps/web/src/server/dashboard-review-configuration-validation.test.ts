import { describe, expect, it, vi } from "vitest";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";

const mocks = vi.hoisted(() => ({
  catalogChecked: vi.fn(async () => false),
  agentProfiles: vi.fn(() => [] as unknown[]),
}));
vi.mock("./context-tools", () => ({
  assertDashboardContextSelectionAllowed: vi.fn(async () => undefined),
}));
vi.mock("./gateway-agent-profile-options", () => ({
  loadApprovedGatewayAgentProfiles: mocks.agentProfiles,
}));
vi.mock("./gateway-review-config-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gateway-review-config-catalog")>()),
  assertGatewayReviewConfigCatalogAllowed: mocks.catalogChecked,
}));
vi.mock("./personal-account-composition", () => ({
  productionPersonalAccounts: async () => null,
}));
vi.mock("./account-gateway-accounts", () => ({
  loadAccountsBootstrap: async () => ({
    page: {
      status: "ok",
      value: {
        profiles: [
          {
            id: "profile-1",
            label: "MiMo",
            provider: "codex",
            protocol: "openai-responses",
            models: ["mimo-v2.6-pro"],
          },
        ],
      },
    },
  }),
}));

const { dashboardProfileModelChangeValidator, dashboardSelectionValidator } =
  await import("./dashboard-review-configuration-validation");

const gatewayConfig = (agenticContext: boolean) =>
  parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "mimo-v2.6-pro",
        reasoningEffort: "high",
        agenticContext,
        fastMode: false,
        requiredHealthy: true,
        gatewayBindingId: "binding-1",
        gatewayProfileRef: "profile-1",
        agentProfileRef: "ocr-managed-v2",
      },
    ],
  });
const repositoryTarget = {
  scope: "repository",
  workspaceId: "workspace_1",
  repositoryId: "repo_1",
} as const;

describe("dashboard selection validator", () => {
  it("applies the dashboard's save rules to every selection candidate", async () => {
    mocks.agentProfiles.mockReturnValue([
      { profileRef: "ocr-managed-v2", agentKind: "ocr" },
    ]);
    const validator = dashboardSelectionValidator({
      workspaceId: "workspace_1",
      repositories: new Map([
        ["repo_1", { fullName: "acme/repo", visibility: "private" }],
      ]),
    });
    await expect(
      validator.validate({
        target: repositoryTarget,
        config: gatewayConfig(false),
      }),
    ).rejects.toThrow("agent_profile_requires_agentic_context");
    // A repository the caller did not authorize is never validated as allowed.
    await expect(
      validator.validate({
        target: { ...repositoryTarget, repositoryId: "repo_other" },
        config: gatewayConfig(true),
      }),
    ).rejects.toThrow("repository_not_found");
  });

  it("rechecks the actor after the network catalog check, before the write", async () => {
    mocks.agentProfiles.mockReturnValue([]);
    mocks.catalogChecked.mockResolvedValueOnce(true);
    const recheck = vi.fn(async () => {
      throw new Error("gateway_review_config_denied");
    });
    const validator = dashboardSelectionValidator({
      workspaceId: "workspace_1",
      repositories: new Map([
        ["repo_1", { fullName: "acme/repo", visibility: "private" }],
      ]),
      afterGatewayCatalogCheck: recheck,
    });
    await expect(
      validator.validate({
        target: repositoryTarget,
        config: gatewayConfig(true),
      }),
    ).rejects.toThrow("gateway_review_config_denied");
    expect(recheck).toHaveBeenCalledWith(repositoryTarget);
  });
});

describe("dashboard provider model edit validator", () => {
  const profile = {
    id: "profile_gateway",
    workspaceId: "workspace_1",
    createdByUserId: "user_owner",
    credential: {
      kind: "gateway_binding",
      authMode: "codex_account_gateway",
      bindingId: "binding-1",
      gatewayProfileRef: "profile-1",
    },
    model: "gpt-5.5",
    label: "Team",
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as const;
  const validator = () =>
    dashboardProfileModelChangeValidator({
      workspaceId: "workspace_1",
      repositories: new Map([
        ["repo_1", { fullName: "acme/repo", visibility: "private" }],
      ]),
    });

  it("refuses a model the account's catalog does not offer before any write", async () => {
    await expect(
      validator().beforeTransaction({ profile, model: "gpt-9" }),
    ).rejects.toThrow("gateway_review_model_unsupported");
    await expect(
      validator().beforeTransaction({ profile, model: "mimo-v2.6-pro" }),
    ).resolves.toBeUndefined();
  });

  it("names the scope whose stored depth the new model does not support", async () => {
    mocks.agentProfiles.mockReturnValue([
      { profileRef: "ocr-managed-v2", agentKind: "ocr" },
    ]);
    const checks = validator();
    await checks.beforeTransaction({ profile, model: "mimo-v2.6-pro" });
    const config = gatewayConfig(true);
    expect(() =>
      checks.scope({ target: repositoryTarget, config }),
    ).not.toThrow();
    const deeper = {
      ...config,
      providers: [{ ...config.providers[0]!, reasoningEffort: "xhigh" }],
    } as typeof config;
    expect(() =>
      checks.scope({ target: repositoryTarget, config: deeper }),
    ).toThrow(
      expect.objectContaining({
        code: "provider_profile_model_incompatible",
        affected: {
          profileId: "profile_gateway",
          workspaceDefault: false,
          repositoryIds: ["repo_1"],
        },
      }),
    );
  });
});
