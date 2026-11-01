import {
  providerApiAuthModes,
  providerApiDescriptors,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  activateConfirmedCodexNamespaceAfterWorkflowMerge: vi.fn(),
  assertDashboardMutationAllowed: vi.fn(),
  assertDashboardRepositoryConfigMutationAllowed: vi.fn(),
  assertDashboardRepositoryMutationAllowed: vi.fn(),
  assertWorkspaceFeatureEntitlement: vi.fn(),
  createGitHubAppInstallationOctokit: vi.fn(),
  getPrisma: vi.fn(),
  recordAuditEvent: vi.fn(),
  dashboardMutationAccessAuditMetadata: vi.fn(),
  readWorkspaceReviewSettingsForm: vi.fn(),
  readRepositoryReviewSettingsForm: vi.fn(),
  saveWorkspaceReviewSettings: vi.fn(),
  saveRepositoryReviewSettings: vi.fn(),
  assertReviewConfigSaveAllowed: vi.fn(),
  assertWorkflowSetupPrAllowed: vi.fn(),
  isWorkflowSetupAlreadyCurrent: vi.fn(),
  resolveReviewRuntimeEnv: vi.fn(),
  provisionGatewayReviewV2Repository: vi.fn(),
  loadApprovedGatewayAgentProfiles: vi.fn(),
}));
vi.mock("../../src/server/gateway-agent-profile-options", () => ({
  loadApprovedGatewayAgentProfiles: mocks.loadApprovedGatewayAgentProfiles,
}));
vi.mock("../../src/server/prisma-gateway-review-v2-provisioning", () => ({
  provisionGatewayReviewV2Repository: mocks.provisionGatewayReviewV2Repository,
}));

vi.mock("../../src/server/workflow-setup-readiness", () => ({
  isWorkflowSetupAlreadyCurrent: mocks.isWorkflowSetupAlreadyCurrent,
}));
vi.mock("@reviewrouter/features-review-config", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-review-config")
  >()),
  resolveReviewRuntimeEnv: mocks.resolveReviewRuntimeEnv,
  saveWorkspaceReviewSettings: mocks.saveWorkspaceReviewSettings,
  saveRepositoryReviewSettings: mocks.saveRepositoryReviewSettings,
}));
vi.mock("./dashboard-action-form-readers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dashboard-action-form-readers")>()),
  readWorkspaceReviewSettingsForm: mocks.readWorkspaceReviewSettingsForm,
  readRepositoryReviewSettingsForm: mocks.readRepositoryReviewSettingsForm,
}));
vi.mock("../../src/server/dashboard-rate-limits", () => ({
  createDashboardRateLimitPolicy: () => ({
    assertReviewConfigSaveAllowed: mocks.assertReviewConfigSaveAllowed,
    assertWorkflowSetupPrAllowed: mocks.assertWorkflowSetupPrAllowed,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@reviewrouter/features-audit-log", () => ({
  recordAuditEvent: mocks.recordAuditEvent,
  PrismaAuditLogRepository: class PrismaAuditLogRepository {},
}));
vi.mock("@reviewrouter/features-entitlements", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-entitlements")
  >()),
  assertWorkspaceFeatureEntitlement: mocks.assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository: class PrismaEntitlementRepository {},
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  asDashboardGitHubActor: vi.fn(),
  assertDashboardMutationAllowed: mocks.assertDashboardMutationAllowed,
  assertDashboardRepositoryConfigMutationAllowed:
    mocks.assertDashboardRepositoryConfigMutationAllowed,
  assertDashboardRepositoryMutationAllowed:
    mocks.assertDashboardRepositoryMutationAllowed,
  createGitHubAppInstallationOctokit: mocks.createGitHubAppInstallationOctokit,
  createGitHubUserOctokit: vi.fn(),
  dashboardMutationAccessAuditMetadata:
    mocks.dashboardMutationAccessAuditMetadata,
  getDashboardSignedInActor: vi.fn(),
  getDashboardWorkspaceScope: vi.fn(),
}));
vi.mock("../../src/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("../../src/server/codex-rotating-workflow-activation", () => ({
  activateConfirmedCodexNamespaceAfterWorkflowMerge:
    mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge,
}));
vi.mock("../../src/server/hosted-pool-workflow-activation", () => ({
  activateConfirmedHostedPoolBindingAfterWorkflowMerge: vi.fn(),
}));
vi.mock("../../src/server/hosted-pool-dashboard", () => ({}));
vi.mock("../../src/server/prisma-hosted-pool-mutations", () => ({
  createPrismaHostedPoolDashboardMutationPort: vi.fn(),
}));
vi.mock("../../src/server/workflow-public-api-url", () => ({
  resolveWorkflowPublicApiUrl: () => "https://api.reviewrouter.test",
}));

import { resolveReviewRouterActionRef } from "@reviewrouter/platform-config";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import {
  renderReviewRouterReusableWorkflow,
  renderClaudeSubscriptionWorkflow,
  reviewRouterWorkflowContract,
} from "@reviewrouter/features-workflow-provisioning";
import {
  createProvisioningPrisma,
  initialCandidate,
} from "../../../../packages/features/workflow-provisioning/src/tests/provisioning-prisma-fixture";

import {
  confirmSetupPullRequestMergedClientAction,
  createSetupPullRequestClientAction,
  saveRepositoryReviewConfigClientAction,
  saveWorkspaceReviewConfigClientAction,
} from "./actions";

const { isWorkflowSetupAlreadyCurrent } = await vi.importActual<
  typeof import("../../src/server/workflow-setup-readiness")
>("../../src/server/workflow-setup-readiness");
const { resolveReviewRuntimeEnv: resolveSavedReviewRuntimeEnv } =
  await vi.importActual<typeof import("@reviewrouter/features-review-config")>(
    "@reviewrouter/features-review-config",
  );

function workspacePolicyHeadsFixture() {
  return {
    findMany: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
      where.workspaceId === "workspace_1"
        ? [{ targetKey: "workspace:default", versions: [{ version: 1 }] }]
        : [],
    ),
  };
}

function reusableWorkflowResponse(claude = true) {
  return {
    data: {
      type: "file",
      encoding: "base64",
      content: Buffer.from(
        renderReviewRouterReusableWorkflow({
          actionRef: resolveReviewRouterActionRef(),
          apiUrl: "https://api.reviewrouter.test",
          runtimeConfigMode: "oidc",
          conflictReviewFallbackEnabled: true,
          ...(claude
            ? {
                staticRuntimeEnv: {
                  REVIEW_AUTH_MODE: "claude-oauth",
                  REVIEW_PROVIDERS: "claude/sonnet",
                },
              }
            : {}),
        }),
      ).toString("base64"),
    },
  };
}

describe("dashboard setup PR recovery", () => {
  it("rejects an unauthorized normal confirmation before GitHub or Gateway provisioning", async () => {
    mocks.getPrisma.mockReturnValue({
      repositoryConnection: {
        findUnique: vi.fn(async () => ({
          id: "repository_1",
          workspaceId: "workspace_1",
          installationId: "installation_1",
          provider: "github",
          githubRepositoryId: 456n,
          owner: "acme",
          name: "widget",
          fullName: "acme/widget",
          defaultBranch: "main",
          visibility: "private",
          selected: true,
          archived: false,
          provisioning: [],
          installation: { status: "active", githubInstallationId: 123n },
        })),
      },
    });
    mocks.assertDashboardRepositoryMutationAllowed.mockRejectedValueOnce(
      new Error("repository_permission_denied"),
    );
    const form = new FormData();
    form.set("workspaceId", "workspace_1");
    form.set("repositoryId", "repository_1");
    const result = await confirmSetupPullRequestMergedClientAction(form);
    expect(result.params).not.toHaveProperty("notice");
    expect(mocks.createGitHubAppInstallationOctokit).not.toHaveBeenCalled();
    expect(mocks.provisionGatewayReviewV2Repository).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboardMutationAccessAuditMetadata.mockReturnValue({});
    mocks.loadApprovedGatewayAgentProfiles.mockReturnValue([]);
    vi.stubEnv(
      "REVIEW_ROUTER_ACTION_REF",
      `777genius/review-router@${"a".repeat(40)}`,
    );
    vi.stubEnv("REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK", "1");
    vi.stubEnv("REVIEW_ROUTER_CONFLICT_REVIEW_FALLBACK_REPOSITORIES", "");
    mocks.assertDashboardRepositoryMutationAllowed.mockResolvedValue({
      actor: "user:maintainer",
    });
    mocks.assertWorkspaceFeatureEntitlement.mockResolvedValue(undefined);
    mocks.createGitHubAppInstallationOctokit.mockResolvedValue({
      request: vi.fn(async (route: string) =>
        route.includes("/contents/")
          ? reusableWorkflowResponse()
          : {
              data: {
                merged: true,
                state: "closed",
                base: { ref: "main" },
                head: { ref: "reviewrouter/setup", sha: "b".repeat(40) },
              },
            },
      ),
    });
    mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge.mockResolvedValue(
      undefined,
    );
    mocks.recordAuditEvent.mockResolvedValue(undefined);
    mocks.isWorkflowSetupAlreadyCurrent.mockImplementation(
      isWorkflowSetupAlreadyCurrent,
    );
    mocks.resolveReviewRuntimeEnv.mockResolvedValue({
      config: parseReviewConfiguration({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "claude",
            authMode: "claude_code_oauth",
            model: "sonnet",
          },
        ],
      }),
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [false, "review_provider_selection_required"],
    [true, "review_policy_resave_required"],
  ] as const)(
    "reports %s workspace presence correctly when a repository policy head remains",
    async (workspacePresent, expectedCode) => {
      mocks.getPrisma.mockReturnValue({
        repositoryConnection: {
          findUnique: vi.fn(async () => ({
            id: "repository_1",
            workspaceId: "workspace_1",
            provider: "github",
            githubRepositoryId: 456n,
            owner: "acme",
            name: "widget",
            fullName: "acme/widget",
            defaultBranch: "main",
            visibility: "private",
            installation: { id: "installation_1", githubInstallationId: 123n },
          })),
        },
        reviewConfiguration: {
          findUnique: vi.fn(
            async ({
              where,
            }: {
              where: { workspaceId_targetKey: { targetKey: string } };
            }) =>
              where.workspaceId_targetKey.targetKey === "repo:repository_1"
                ? {
                    versions: [
                      {
                        version: 7,
                        schemaVersion: 3,
                        policyJson: JSON.stringify({ schemaVersion: 3 }),
                      },
                    ],
                  }
                : workspacePresent
                  ? {
                      versions: [
                        { version: 1, schemaVersion: 2, policyJson: null },
                      ],
                    }
                  : null,
          ),
        },
      });
      mocks.resolveReviewRuntimeEnv.mockImplementationOnce(
        resolveSavedReviewRuntimeEnv,
      );
      const form = new FormData();
      form.set("workspaceId", "workspace_1");
      form.set("repositoryId", "repository_1");
      const result = await createSetupPullRequestClientAction(form);
      expect(result.params.error).toBe(expectedCode);
      expect(mocks.resolveReviewRuntimeEnv).toHaveBeenCalledOnce();
      expect(mocks.createGitHubAppInstallationOctokit).not.toHaveBeenCalled();
    },
  );

  // RED if inherited Gateway is refused before setup, unsupported workflow
  // options pass through, or setup reaches GitHub before actor authorization.
  it.each(["allowed", "explicit", "suggest", "unauthorized"] as const)(
    "handles inherited workspace Gateway setup: %s",
    async (scenario) => {
      mocks.getPrisma.mockReturnValue({
        repositoryConnection: {
          findUnique: vi.fn(async () => ({
            workspaceId: "workspace_1",
            provider: "github",
            githubRepositoryId: 456n,
            owner: "acme",
            name: "widget",
            fullName: "acme/widget",
            defaultBranch: "main",
            visibility: "private",
            installation: { id: "installation_1", githubInstallationId: 123n },
          })),
        },
        reviewConfiguration: workspacePolicyHeadsFixture(),
      });
      mocks.resolveReviewRuntimeEnv.mockResolvedValue({
        source: "workspace",
        config: parseReviewConfiguration({
          ...workspacePolicyFixture,
          providers: [
            {
              kind: "codex",
              authMode: "codex_account_gateway",
              gatewayBindingId: "binding_1",
              gatewayProfileRef: "default",
              model: "gpt-5.5",
            },
          ],
        }),
      });
      vi.stubEnv(
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF",
        `777genius/review-router@${"a".repeat(40)}`,
      );
      mocks.isWorkflowSetupAlreadyCurrent.mockResolvedValue(true);
      if (scenario === "unauthorized") {
        mocks.assertDashboardRepositoryMutationAllowed.mockRejectedValueOnce(
          new Error("repository_mutation_forbidden"),
        );
      }
      const form = new FormData();
      form.set("workspaceId", "workspace_1");
      form.set("repositoryId", "repository_1");
      form.set(
        "workflowStyle",
        scenario === "explicit" ? "explicit" : "reusable",
      );
      form.set(
        "reviewDiscussionMode",
        scenario === "suggest" ? "suggest" : "off",
      );

      const result = await createSetupPullRequestClientAction(form);

      if (scenario === "allowed") {
        expect(result.params).toMatchObject({
          notice: "workflow_already_current",
        });
        expect(mocks.isWorkflowSetupAlreadyCurrent).toHaveBeenCalledWith(
          expect.objectContaining({ codexSessionMode: "account-gateway" }),
          expect.anything(),
        );
        expect(mocks.assertWorkspaceFeatureEntitlement).toHaveBeenCalledWith(
          expect.objectContaining({
            feature: "workflow_provisioning",
            actor: "user:maintainer",
          }),
          expect.anything(),
        );
      } else {
        expect(result.params.error).toBe(
          scenario === "unauthorized"
            ? "repository_mutation_forbidden"
            : "account_gateway_workflow_options_not_supported",
        );
        expect(mocks.createGitHubAppInstallationOctokit).not.toHaveBeenCalled();
        expect(mocks.isWorkflowSetupAlreadyCurrent).not.toHaveBeenCalled();
        if (scenario === "unauthorized") {
          expect(mocks.resolveReviewRuntimeEnv).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(
    providerApiAuthModes.flatMap((mode) =>
      [
        "single",
        "multiple",
        "explicit",
        ...(mode === "mimo-token-plan-api" ? ["legacy_effort"] : []),
      ].map((scenario) => ({ mode, scenario })),
    ),
  )(
    "selects the App-first direct $mode setup before effects: $scenario",
    async ({ mode, scenario }) => {
      mocks.getPrisma.mockReturnValue({
        repositoryConnection: {
          findUnique: vi.fn(async () => ({
            workspaceId: "workspace_1",
            provider: "github",
            githubRepositoryId: 456n,
            owner: "acme",
            name: "widget",
            fullName: "acme/widget",
            defaultBranch: "main",
            visibility: "private",
            installation: { id: "installation_1", githubInstallationId: 123n },
          })),
        },
        reviewConfiguration: workspacePolicyHeadsFixture(),
      });
      const descriptor = providerApiDescriptors[mode];
      const provider = {
        kind: descriptor.providerKind,
        authMode: descriptor.authMode,
        model: descriptor.defaultModel,
        ...(mode === "kimi-code-api"
          ? {}
          : {
              reasoningEffort: scenario === "legacy_effort" ? "xhigh" : "high",
            }),
      };
      mocks.resolveReviewRuntimeEnv.mockResolvedValue({
        config: parseReviewConfiguration({
          ...workspacePolicyFixture,
          providers:
            scenario === "multiple"
              ? [
                  provider,
                  {
                    kind: "claude",
                    authMode: "claude_code_oauth",
                    model: "sonnet",
                  },
                ]
              : [provider],
          execution: {
            providerLimit: scenario === "multiple" ? 2 : 1,
            providerMaxParallel: 1,
            inlineMinAgreement: 1,
          },
        }),
      });
      vi.stubEnv(
        "REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF",
        `777genius/review-router@${"c".repeat(40)}`,
      );
      mocks.isWorkflowSetupAlreadyCurrent.mockResolvedValue(true);
      const form = new FormData();
      form.set("workspaceId", "workspace_1");
      form.set("repositoryId", "repository_1");
      form.set(
        "workflowStyle",
        scenario === "explicit" ? "explicit" : "reusable",
      );
      const result = await createSetupPullRequestClientAction(form);
      if (scenario === "single") {
        expect(result.params.notice).toBe("workflow_already_current");
        expect(mocks.isWorkflowSetupAlreadyCurrent).toHaveBeenCalledWith(
          expect.objectContaining({
            providerApiAuthMode: mode,
            actionRef: `777genius/review-router@${"c".repeat(40)}`,
            conflictReviewFallbackEnabled: false,
          }),
          expect.anything(),
        );
        expect(
          mocks.isWorkflowSetupAlreadyCurrent.mock.calls[0]?.[0],
        ).not.toHaveProperty("codexSessionMode");
      } else {
        expect(result.params.error).toBe(
          scenario === "legacy_effort"
            ? "provider_api_reasoning_effort_unsupported"
            : scenario === "multiple"
              ? mode === "openrouter-api"
                ? "openrouter_direct_requires_single_provider"
                : "provider_api_direct_requires_single_provider"
              : "openrouter_direct_workflow_options_not_supported",
        );
        expect(mocks.createGitHubAppInstallationOctokit).not.toHaveBeenCalled();
        expect(mocks.provisionGatewayReviewV2Repository).not.toHaveBeenCalled();
      }
    },
  );

  it("saves the workspace settings of the form and never a provider", async () => {
    const settings = { blockingPolicy: { failOnSeverity: "major" } } as const;
    mocks.getPrisma.mockReturnValue({});
    mocks.assertDashboardMutationAllowed.mockResolvedValue({
      actor: "user:admin",
      userId: "user_admin",
    });
    mocks.readWorkspaceReviewSettingsForm.mockReturnValue(settings);
    mocks.dashboardMutationAccessAuditMetadata.mockReturnValue({
      accessSource: "workspace_admin",
    });
    mocks.saveWorkspaceReviewSettings.mockResolvedValue({
      target: { scope: "workspace", workspaceId: "workspace_1" },
      version: 2,
      configuration: null,
    });
    const formData = new FormData();
    formData.set("workspaceId", "workspace_1");
    formData.set("policyExpectedVersion", "1");

    await expect(
      saveWorkspaceReviewConfigClientAction(formData),
    ).resolves.toEqual({
      params: {
        notice: "review_config_saved",
        version: "2",
        workspace: "workspace_1",
        section: "policy",
      },
    });
    expect(mocks.assertWorkspaceFeatureEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        feature: "action_control_plane",
      }),
      expect.anything(),
    );
    expect(mocks.saveWorkspaceReviewSettings).toHaveBeenCalledWith(
      {
        workspaceId: "workspace_1",
        actor: expect.objectContaining({ userId: "user_admin" }),
        settings,
        expectedVersion: 1,
        auditMetadata: { accessSource: "workspace_admin" },
      },
      // The dashboard validates every candidate before the write.
      expect.objectContaining({ validator: expect.anything() }),
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("saves the repository overrides of the form with the actor's capability", async () => {
    mocks.dashboardMutationAccessAuditMetadata.mockReturnValue({
      accessSource: "repo_manager",
      accessCapability: "direct_config",
    });
    mocks.getPrisma.mockReturnValue({
      repositoryConnection: {
        findUnique: vi.fn(async () => ({
          id: "repository_1",
          workspaceId: "workspace_1",
          provider: "github",
          githubRepositoryId: 456n,
          owner: "acme",
          name: "widget",
          fullName: "acme/widget",
          defaultBranch: "main",
          visibility: "private",
          selected: true,
          archived: false,
          installation: { status: "active", githubInstallationId: 123n },
        })),
      },
    });
    mocks.assertDashboardRepositoryConfigMutationAllowed.mockResolvedValue({
      actor: "user:maintainer",
      userId: "user_maintainer",
      accessSource: { source: "repo_manager", capability: "direct_config" },
    });
    mocks.readRepositoryReviewSettingsForm.mockReturnValue({
      limits: { inlineMaxComments: 2 },
    });
    mocks.saveRepositoryReviewSettings.mockResolvedValue({
      target: {
        scope: "repository",
        workspaceId: "workspace_1",
        repositoryId: "repository_1",
      },
      version: 3,
      configuration: null,
    });
    const formData = new FormData();
    formData.set("workspaceId", "workspace_1");
    formData.set("repositoryId", "repository_1");
    formData.set("policyExpectedVersion", "2");

    await expect(
      saveRepositoryReviewConfigClientAction(formData),
    ).resolves.toEqual({
      params: {
        notice: "repository_review_config_saved",
        repository: "acme/widget",
        version: "3",
      },
    });
    expect(mocks.saveRepositoryReviewSettings).toHaveBeenCalledWith(
      {
        workspaceId: "workspace_1",
        actor: expect.objectContaining({ userId: "user_maintainer" }),
        repository: {
          repositoryId: "repository_1",
          capability: "direct_config",
        },
        settings: { limits: { inlineMaxComments: 2 } },
        expectedVersion: 2,
        auditMetadata: {
          repository: "acme/widget",
          accessSource: "repo_manager",
          accessCapability: "direct_config",
        },
      },
      expect.objectContaining({ validator: expect.anything() }),
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("loads failed provisioning deterministically and confirms a reopened merged PR", async () => {
    let provisioningStatus: "failed" | "configured" = "failed";
    let claudeWorkflow = true;
    const repositoryFindUnique = vi.fn(async () => ({
      id: "repository_1",
      workspaceId: "workspace_1",
      installationId: "installation_1",
      provider: "github",
      githubRepositoryId: 456n,
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      visibility: "private",
      defaultBranch: "main",
      selected: true,
      archived: false,
      installation: { status: "active", githubInstallationId: 123n },
      provisioning: [
        {
          attemptId: "attempt_1",
          revision: 1,
          workflowPath: ".github/workflows/reviewrouter.yml",
          workflowStyle: "reusable",
          actionVersion: resolveReviewRouterActionRef(),
          branch: "reviewrouter/setup",
          pullRequestUrl: "https://github.com/acme/widget/pull/7",
          pullRequestHeadSha: "b".repeat(40),
        },
      ],
    }));
    const workflowProvisioning = {
      findFirst: vi.fn(async () => ({
        id: "provisioning_1",
        workspaceId: "workspace_1",
        repositoryId: "repository_1",
        installationId: "installation_1",
        attemptId: "attempt_1",
        revision: 1,
        workflowPath: ".github/workflows/reviewrouter.yml",
        workflowStyle: "reusable",
        actionVersion: resolveReviewRouterActionRef(),
        status: provisioningStatus,
        branch: "reviewrouter/setup",
        pullRequestUrl: "https://github.com/acme/widget/pull/7",
        pullRequestHeadSha: "b".repeat(40),
        errorMessage:
          provisioningStatus === "failed" ? "setup_pr_closed" : null,
      })),
      updateMany: vi.fn(async () => {
        provisioningStatus = "configured";
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => workflowProvisioning.findFirst()),
    };
    const transactionClient = {
      workflowProvisioning,
      repositoryConnection: {
        findFirst: vi.fn(async () => ({ defaultBranch: "main" })),
      },
    };
    mocks.getPrisma.mockReturnValue({
      reviewConfiguration: workspacePolicyHeadsFixture(),
      repositoryConnection: {
        findUnique: repositoryFindUnique,
        findFirst: transactionClient.repositoryConnection.findFirst,
      },
      hostedCodexRepositoryBinding: { findFirst: vi.fn(async () => null) },
      workflowProvisioning,
      $transaction: vi.fn(
        async (callback: (tx: typeof transactionClient) => unknown) =>
          callback(transactionClient),
      ),
    });
    mocks.createGitHubAppInstallationOctokit.mockResolvedValue({
      request: vi.fn(async (route: string) =>
        route.includes("/contents/")
          ? reusableWorkflowResponse(claudeWorkflow)
          : {
              data: {
                merged: true,
                state: "closed",
                base: { ref: "main" },
                head: { ref: "reviewrouter/setup", sha: "b".repeat(40) },
              },
            },
      ),
    });
    const formData = new FormData();
    formData.set("repositoryId", "repository_1");
    formData.set("workspaceId", "workspace_1");

    await expect(
      confirmSetupPullRequestMergedClientAction(formData),
    ).resolves.toEqual({
      params: {
        notice: "setup_pr_merged",
        repository: "acme/widget",
        workspace: "workspace_1",
        section: "repositories",
      },
    });

    expect(repositoryFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          provisioning: {
            where: {
              workspaceId: "workspace_1",
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              attemptId: true,
              revision: true,
              branch: true,
              workflowPath: true,
              actionVersion: true,
              pullRequestUrl: true,
              pullRequestHeadSha: true,
            },
          },
        }),
      }),
    );
    expect(workflowProvisioning.updateMany).toHaveBeenCalledTimes(1);

    await expect(
      confirmSetupPullRequestMergedClientAction(formData),
    ).resolves.toMatchObject({ params: { notice: "setup_pr_merged" } });
    expect(workflowProvisioning.updateMany).toHaveBeenCalledTimes(1);

    mocks.resolveReviewRuntimeEnv.mockResolvedValueOnce({
      config: parseReviewConfiguration({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "claude",
            authMode: "claude_code_oauth",
            model: "sonnet",
          },
        ],
      }),
    });
    claudeWorkflow = true;
    await expect(
      confirmSetupPullRequestMergedClientAction(formData),
    ).resolves.toMatchObject({ params: { notice: "setup_pr_merged" } });
    expect(workflowProvisioning.updateMany).toHaveBeenCalledTimes(1);
  });
  it("confirms the native Claude caller using only selected provisioning fields", async () => {
    const actionRef = resolveReviewRouterActionRef();
    const candidate = { ...initialCandidate, actionVersion: actionRef };
    const state = createProvisioningPrisma(candidate);
    const repository = {
      id: "repository_1",
      workspaceId: "workspace_1",
      installationId: "installation_1",
      provider: "github",
      githubRepositoryId: 456n,
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      visibility: "private",
      defaultBranch: "main",
      selected: true,
      archived: false,
      installation: { status: "active", githubInstallationId: 123n },
    };
    const findRepository = vi.fn(
      async (input: {
        select: { provisioning: { select: Record<string, boolean> } };
      }) => ({
        ...repository,
        // A real Prisma projection does not expose unselected actionVersion.
        provisioning: [
          Object.fromEntries(
            Object.keys(input.select.provisioning.select).map((key) => [
              key,
              candidate[key as keyof typeof candidate],
            ]),
          ),
        ],
      }),
    );
    mocks.getPrisma.mockReturnValue({
      ...state.prisma,
      reviewConfiguration: workspacePolicyHeadsFixture(),
      repositoryConnection: {
        ...state.repositoryConnection,
        findUnique: findRepository,
      },
      hostedCodexRepositoryBinding: { findFirst: vi.fn(async () => null) },
    });
    const source = renderClaudeSubscriptionWorkflow({
      actionRef,
      apiUrl: "https://api.reviewrouter.test",
    }).content;
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(source)}\0${source}`)
      .digest("hex");
    const commitSha = "c".repeat(40);
    mocks.createGitHubAppInstallationOctokit.mockResolvedValue({
      request: vi.fn(
        async (route: string, parameters?: Record<string, unknown>) => {
          if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}")
            return {
              data: {
                merged: true,
                state: "closed",
                base: { ref: "main" },
                head: {
                  ref: candidate.branch,
                  sha: candidate.pullRequestHeadSha,
                },
              },
            };
          if (route === "GET /repos/{owner}/{repo}")
            return {
              data: {
                id: 456,
                full_name: "acme/widget",
                default_branch: "main",
              },
            };
          if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}")
            return {
              data: { object: { sha: commitSha } },
            };
          if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
            expect(parameters?.ref).toBe(commitSha);
            if (parameters?.path !== reviewRouterWorkflowContract.callerPath)
              throw Object.assign(new Error("missing"), { status: 404 });
            return {
              data: {
                type: "file",
                encoding: "base64",
                sha: blobSha,
                path: reviewRouterWorkflowContract.callerPath,
                content: Buffer.from(source).toString("base64"),
              },
            };
          }
          throw new Error(`unexpected_github_request:${route}`);
        },
      ),
    });
    mocks.provisionGatewayReviewV2Repository.mockImplementationOnce(
      async (input: { assertCurrentSetupAndSource(): Promise<void> }) => {
        await input.assertCurrentSetupAndSource();
        return { status: "ready" };
      },
    );
    const form = new FormData();
    form.set("workspaceId", "workspace_1");
    form.set("repositoryId", "repository_1");
    const result = await confirmSetupPullRequestMergedClientAction(form);
    expect(result).toMatchObject({ params: { notice: "setup_pr_merged" } });
    expect(findRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          provisioning: expect.objectContaining({
            select: expect.objectContaining({ actionVersion: true }),
          }),
        }),
      }),
    );
    expect(mocks.provisionGatewayReviewV2Repository).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionAuthMode: "claude-oauth",
        command: expect.objectContaining({
          expectedGatewaySource: expect.objectContaining({
            actionRef,
            sourceRevision: commitSha,
          }),
        }),
      }),
    );
    expect(
      mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge,
    ).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({
      status: "configured",
      actionVersion: actionRef,
    });
  });

  it.each([
    "verified",
    "workflow_absent",
    "activation_failed",
    "transfer_placeholder",
    "native_probe_denied",
    "native_probe_malformed",
  ] as const)(
    "handles installed workflow without bound provisioning evidence: %s",
    async (scenario) => {
      const marker =
        scenario === "transfer_placeholder"
          ? {
              ...initialCandidate,
              status: "not_started" as const,
              workflowStyle: "explicit" as const,
              actionVersion: "",
              pullRequestHeadSha: null,
              pullRequestUrl: null,
            }
          : null;
      const state = createProvisioningPrisma(marker);
      const repository = {
        id: "repository_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        provider: "github",
        githubRepositoryId: 456n,
        owner: "acme",
        name: "widget",
        fullName: "acme/widget",
        visibility: "private",
        defaultBranch: "main",
        selected: true,
        archived: false,
        installation: { status: "active", githubInstallationId: 123n },
        provisioning: marker ? [marker] : [],
      };
      mocks.getPrisma.mockReturnValue({
        ...state.prisma,
        reviewConfiguration: workspacePolicyHeadsFixture(),
        repositoryConnection: {
          ...state.repositoryConnection,
          findUnique: vi.fn(async () => repository),
        },
        hostedCodexRepositoryBinding: { findFirst: vi.fn(async () => null) },
      });
      const request = vi.fn(
        async (route: string, parameters?: Record<string, unknown>) => {
          if (!route.includes("/contents/")) return { data: {} };
          if (parameters?.path === reviewRouterWorkflowContract.callerPath) {
            if (scenario === "native_probe_denied")
              throw Object.assign(new Error("denied"), { status: 403 });
            if (scenario === "native_probe_malformed")
              return reusableWorkflowResponse();
            // This installation contains only the original legacy caller.
            throw Object.assign(new Error("missing"), { status: 404 });
          }
          expect(parameters?.path).toBe(".github/workflows/reviewrouter.yml");
          return reusableWorkflowResponse();
        },
      );
      mocks.createGitHubAppInstallationOctokit.mockResolvedValue({ request });
      if (scenario === "workflow_absent")
        mocks.isWorkflowSetupAlreadyCurrent.mockResolvedValue(false);
      if (scenario === "activation_failed")
        mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge.mockRejectedValueOnce(
          new Error("activation_failed"),
        );
      const form = new FormData();
      form.set("workspaceId", "workspace_1");
      form.set("repositoryId", "repository_1");
      const result = await confirmSetupPullRequestMergedClientAction(form);
      if (scenario === "verified" || scenario === "transfer_placeholder") {
        expect(result).toMatchObject({ params: { notice: "setup_pr_merged" } });
        expect(state.current()).toMatchObject({
          status: "configured",
          pullRequestUrl: null,
          pullRequestHeadSha: null,
          workflowPath: ".github/workflows/reviewrouter.yml",
          workflowStyle: "reusable",
          actionVersion: resolveReviewRouterActionRef(),
        });
        expect(mocks.isWorkflowSetupAlreadyCurrent).toHaveBeenCalledWith(
          expect.objectContaining({
            defaultBranch: "main",
            githubInstallationId: "123",
          }),
          expect.anything(),
        );
        expect(
          mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge,
        ).toHaveBeenCalled();
      } else {
        expect(result.params).not.toHaveProperty("notice");
        expect(state.workflowProvisioning.create).not.toHaveBeenCalled();
        if (scenario.startsWith("native_probe_")) {
          expect(mocks.isWorkflowSetupAlreadyCurrent).not.toHaveBeenCalled();
          expect(
            mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge,
          ).not.toHaveBeenCalled();
          expect(
            mocks.provisionGatewayReviewV2Repository,
          ).not.toHaveBeenCalled();
        }
      }
      expect(request.mock.calls.flat()).not.toContain(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      );
    },
  );

  it.each([
    "verified",
    "workflow_absent",
    "workflow_wrong_ref",
    "activation_failed",
    "unmerged_wrong_base",
    "stored_head_wrong_base",
    "head_mismatch",
    "head_mismatch_tampered",
    "wrong_workspace",
    "missing_installation",
    "transfer_during_probe",
    "installation_during_probe",
    "attempt_during_probe",
    "revision_during_probe",
    "head_during_probe",
    "branch_during_probe",
    "url_during_probe",
    "artifact_path",
    "artifact_style",
    "artifact_version",
    "transfer_during_activation",
    "attempt_during_activation",
    "revision_during_activation",
  ] as const)(
    "composes the real inspector, workflow probe and confirmation across master -> main: %s",
    async (scenario) => {
      const historical = {
        ...initialCandidate,
        pullRequestHeadSha: scenario.startsWith("head_mismatch")
          ? "c".repeat(40)
          : scenario === "stored_head_wrong_base"
            ? "b".repeat(40)
            : null,
        workflowPath:
          scenario === "artifact_path"
            ? ".github/workflows/other.yml"
            : ".github/workflows/reviewrouter.yml",
        workflowStyle:
          scenario === "artifact_style"
            ? ("explicit" as const)
            : ("reusable" as const),
        actionVersion:
          scenario === "artifact_version"
            ? "obsolete"
            : resolveReviewRouterActionRef(),
      };
      const state = createProvisioningPrisma(historical);
      const repository = {
        id: "repository_1",
        workspaceId: "workspace_1",
        installationId:
          scenario === "missing_installation" ? null : "installation_1",
        provider: "github",
        githubRepositoryId: 456n,
        owner: "acme",
        name: "widget",
        fullName: "acme/widget",
        visibility: "private",
        defaultBranch: "main",
        selected: true,
        archived: false,
        installation: { status: "active", githubInstallationId: 123n },
        provisioning: [historical],
      };
      mocks.getPrisma.mockReturnValue({
        ...state.prisma,
        reviewConfiguration: workspacePolicyHeadsFixture(),
        repositoryConnection: {
          ...state.repositoryConnection,
          findUnique: vi.fn(async () => repository),
        },
        hostedCodexRepositoryBinding: { findFirst: vi.fn(async () => null) },
      });
      const events: string[] = [];
      let expectedCurrent = historical;
      function changeAttempt() {
        if (scenario.startsWith("transfer_")) state.transfer();
        if (scenario.startsWith("installation_"))
          state.replace({ ...historical, installationId: "installation_2" });
        if (scenario.startsWith("attempt_"))
          state.replace({ ...historical, attemptId: "new_attempt" });
        if (scenario.startsWith("revision_"))
          state.replace({ ...historical, revision: historical.revision + 1 });
        if (scenario === "head_during_probe")
          state.replace({ ...historical, pullRequestHeadSha: "b".repeat(40) });
        if (scenario === "branch_during_probe")
          state.replace({ ...historical, branch: "reviewrouter/new-setup" });
        if (scenario === "url_during_probe")
          state.replace({
            ...historical,
            pullRequestUrl: "https://github.com/acme/widget/pull/8",
          });
        expectedCurrent = state.current()!;
      }
      const request = vi.fn(
        async (route: string, parameters?: Record<string, unknown>) => {
          if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}") {
            events.push("inspect_pr");
            return {
              data: {
                merged: scenario !== "unmerged_wrong_base",
                state: scenario === "unmerged_wrong_base" ? "open" : "closed",
                base: {
                  ref: scenario.startsWith("head_mismatch") ? "main" : "master",
                },
                head: { ref: historical.branch, sha: "b".repeat(40) },
              },
            };
          }
          if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
            events.push(`workflow:${parameters?.ref}`);
            if (scenario.endsWith("_during_probe")) changeAttempt();
            // Even though master has valid bytes, only current main is authoritative.
            if (parameters?.ref === "main" && scenario === "workflow_absent")
              throw Object.assign(new Error("missing"), { status: 404 });
            const ref =
              parameters?.ref === "main" &&
              (scenario === "workflow_wrong_ref" ||
                scenario === "head_mismatch_tampered")
                ? `777genius/review-router@${"d".repeat(40)}`
                : resolveReviewRouterActionRef();
            return {
              data: {
                type: "file",
                encoding: "base64",
                content: Buffer.from(
                  renderReviewRouterReusableWorkflow({
                    actionRef: ref,
                    apiUrl: "https://api.reviewrouter.test",
                    runtimeConfigMode: "oidc",
                    conflictReviewFallbackEnabled: true,
                    staticRuntimeEnv: {
                      REVIEW_AUTH_MODE: "claude-oauth",
                      REVIEW_PROVIDERS: "claude/sonnet",
                    },
                  }),
                ).toString("base64"),
              },
            };
          }
          throw new Error(`unexpected_github_request:${route}`);
        },
      );
      mocks.createGitHubAppInstallationOctokit.mockResolvedValue({ request });
      mocks.isWorkflowSetupAlreadyCurrent.mockImplementation(
        isWorkflowSetupAlreadyCurrent,
      );
      mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge.mockImplementation(
        async () => {
          events.push("activation");
          if (scenario.endsWith("_during_activation")) changeAttempt();
          if (scenario === "activation_failed")
            throw new Error("activation_failed");
        },
      );
      const form = new FormData();
      form.set(
        "workspaceId",
        scenario === "wrong_workspace" ? "workspace_2" : "workspace_1",
      );
      form.set("repositoryId", "repository_1");
      const result = await confirmSetupPullRequestMergedClientAction(form);
      if (scenario === "verified" || scenario === "head_mismatch") {
        expect({ params: result.params, events }).toMatchObject({
          params: { notice: "setup_pr_merged" },
          events: ["inspect_pr", "workflow:main", "activation"],
        });
        expect(state.current()).toEqual({
          ...historical,
          status: "configured",
          installedWorkflowRequirement: "ci_secrets+claude",
          revision: historical.revision + 1,
        });
        expect(state.workflowProvisioning.updateMany).toHaveBeenCalledTimes(1);
        expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ source: "workflow" }),
          }),
          expect.anything(),
        );
      } else {
        expect(result.params).not.toHaveProperty("notice");
        expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
        if (
          scenario === "unmerged_wrong_base" ||
          scenario === "stored_head_wrong_base"
        ) {
          expect(result.params.error).toBe("setup_pr_wrong_base_branch");
          expect(events).toEqual(["inspect_pr"]);
          expect(state.current()).toEqual({
            ...historical,
            status: "failed",
            errorMessage: "setup_pr_wrong_base_branch",
            revision: historical.revision + 1,
          });
        } else if (scenario === "head_mismatch_tampered") {
          // A merged PR whose head is not the recorded artifact merged foreign
          // bytes: a permanent mismatch that recovers by recreation instead of
          // retrying an endless not-merged wait.
          expect(result.params.error).toBe("setup_pr_workflow_mismatch");
          expect(events).toEqual(["inspect_pr", "workflow:main"]);
          expect(state.current()).toEqual({
            ...historical,
            status: "failed",
            errorMessage: "setup_pr_workflow_mismatch",
            revision: historical.revision + 1,
          });
        } else {
          expect(state.workflowProvisioning.updateMany).not.toHaveBeenCalled();
          expect(state.current()).toEqual(expectedCurrent);
          if (
            scenario === "workflow_absent" ||
            scenario === "workflow_wrong_ref"
          )
            expect(result.params.error).toBe("setup_pr_not_merged");
          if (scenario.includes("_during_") || scenario.startsWith("artifact_"))
            expect(result.params.error).toBe("github_operation_failed");
          expect(events).toEqual(
            scenario === "wrong_workspace" ||
              scenario === "missing_installation"
              ? []
              : scenario === "activation_failed" ||
                  scenario.endsWith("_during_activation")
                ? ["inspect_pr", "workflow:main", "activation"]
                : ["inspect_pr", "workflow:main"],
          );
        }
        if (
          scenario !== "activation_failed" &&
          !scenario.endsWith("_during_activation")
        )
          expect(
            mocks.activateConfirmedCodexNamespaceAfterWorkflowMerge,
          ).not.toHaveBeenCalled();
      }
      expect(state.workflowProvisioning.create).not.toHaveBeenCalled();
      for (const [route, parameters] of request.mock.calls) {
        if (route.includes("/contents/")) {
          expect(parameters).toEqual({
            owner: "acme",
            repo: "widget",
            ref: "main",
            path: ".github/workflows/reviewrouter.yml",
          });
        }
      }
      if (scenario !== "wrong_workspace" && scenario !== "missing_installation")
        expect(mocks.createGitHubAppInstallationOctokit).toHaveBeenCalledWith(
          "123",
        );
    },
  );
});
