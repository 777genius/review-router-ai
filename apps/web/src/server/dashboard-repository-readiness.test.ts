import {
  parseReviewConfiguration,
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import type { GatewayReviewV2RepositoryReadiness } from "./prisma-gateway-review-v2-provisioning";
import { describe, expect, it } from "vitest";
import { requiredWorkflowRequirement } from "@reviewrouter/features-workflow-provisioning";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import { resolveDashboardRepositoryReadiness } from "./dashboard-repository-readiness";
import {
  runtimeReadySha,
  runtimeReleases,
} from "./test-support/review-runtime-readiness-fixture";

function codexConfig(
  authMode:
    | "codex_subscription_oauth_hosted_pool"
    | "codex_subscription_oauth_rotating",
): ReviewConfiguration {
  return parseReviewConfigurationStrict({
    schemaVersion: 3,
    providers: [
      {
        kind: "codex",
        authMode,
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
  });
}

function updateRequired(input: {
  readonly policy: ReviewConfiguration;
  readonly installed: string;
  readonly hosted: { readonly activation: "pending" | "active" } | null;
}): boolean {
  const [result] = resolveDashboardRepositoryReadiness({
    effectiveConfigs: new Map([["repo_1", input.policy]]),
    repositories: [
      {
        id: "repo_1",
        fullName: "acme/widget",
        provider: "github",
        selected: true,
        archived: false,
        setupStatus: "configured",
        setupNeedsAttention: false,
        installedWorkflowRequirement: input.installed,
      },
    ],
    health: [{ repositoryId: "repo_1", status: "healthy" }],
    providerSetup: [],
    hostedRepositories: input.hosted
      ? [
          {
            id: "repo_1",
            source: "hosted_workspace_pool",
            activation: input.hosted.activation,
          },
        ]
      : [],
    gatewayAccounts: undefined,
    gatewayReadiness: new Map(),
    providerSecretCheckFailedRepositoryFullName: null,
  });
  return result!.workflowUpdateRequired;
}

describe("dashboard repository readiness during a hosted pool switch", () => {
  const hosted = codexConfig("codex_subscription_oauth_hosted_pool");
  const rotating = codexConfig("codex_subscription_oauth_rotating");

  it("keeps a merged rotating workflow current until confirm switches the hosted policy", () => {
    expect(
      updateRequired({
        policy: hosted,
        installed: "rotating",
        hosted: { activation: "active" },
      }),
    ).toBe(false);
  });

  it("keeps a merged hosted workflow current until activation switches the rotating policy", () => {
    expect(
      updateRequired({
        policy: rotating,
        installed: "hosted_pool",
        hosted: { activation: "pending" },
      }),
    ).toBe(false);
  });

  it("still requires an update without a hosted pool binding", () => {
    expect(
      updateRequired({ policy: hosted, installed: "rotating", hosted: null }),
    ).toBe(true);
    expect(
      updateRequired({
        policy: rotating,
        installed: "ci_secrets+claude",
        hosted: { activation: "active" },
      }),
    ).toBe(true);
  });
});

describe("dashboard repository readiness of a merged Gateway setup", () => {
  const gateway = parseReviewConfiguration({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding_1",
        gatewayProfileRef: "openai-responses-apikey-v1",
        model: "mimo-v2.6-pro",
        reasoningEffort: "medium",
        agenticContext: true,
        fastMode: false,
      },
    ],
  });

  function merged(readiness: GatewayReviewV2RepositoryReadiness | undefined) {
    const [result] = resolveDashboardRepositoryReadiness({
      effectiveConfigs: new Map([["repo_1", gateway]]),
      repositories: [
        {
          id: "repo_1",
          fullName: "acme/widget",
          provider: "github",
          selected: true,
          archived: false,
          setupStatus: "configured",
          setupNeedsAttention: false,
          installedWorkflowRequirement: "gateway",
          workflowProvisioning: {
            status: "configured",
            actionVersion: "workflow-v1",
          },
        },
      ],
      health: [{ repositoryId: "repo_1", status: "healthy" }],
      providerSetup: [],
      hostedRepositories: [],
      gatewayAccounts: undefined,
      gatewayReadiness: readiness
        ? new Map([["repo_1", readiness]])
        : new Map(),
      providerSecretCheckFailedRepositoryFullName: null,
    });
    return {
      step: result!.step,
      state: result!.state,
      verificationNeeded: result!.verificationNeeded,
    };
  }

  it.each<readonly [string, GatewayReviewV2RepositoryReadiness | undefined]>([
    ["no authority yet", undefined],
    [
      "a missing authority",
      { status: "blocked", issue: "mutation_authority_unavailable" },
    ],
    [
      "a missing repository identity",
      { status: "conflict", issue: "gateway_repository_identity_missing" },
    ],
  ])("waits for its verification on the merge step with %s", (_name, value) => {
    expect(merged(value)).toEqual({
      step: "merge_setup_pr",
      state: "setting_up",
      verificationNeeded: true,
    });
  });

  it.each<readonly [string, GatewayReviewV2RepositoryReadiness]>([
    [
      "paused",
      { status: "paused", authorityVersion: 1, recoveryReference: "x" },
    ],
    [
      "safety blocked",
      { status: "blocked", issue: "gateway_review_v2_safety_blocked" },
    ],
  ])("needs attention when its authorization is %s", (_name, value) => {
    expect(merged(value)).toMatchObject({
      step: "setup_pr",
      state: "attention",
    });
  });
});

describe("dashboard repository states of the composed readiness", () => {
  const installed = requiredWorkflowRequirement(workspacePolicyFixture);
  const reportedAt = new Date("2026-01-02T00:00:00Z");

  type Row = Readonly<{
    selected?: boolean;
    started?: boolean;
    setupNeedsAttention?: boolean;
    health?: "healthy" | "provider_unhealthy" | "missing_workflow";
    credential?: boolean;
  }>;

  function stateOf(row: Row): string {
    const started = row.started ?? true;
    const [result] = resolveDashboardRepositoryReadiness({
      effectiveConfigs: new Map([["repo_1", workspacePolicyFixture]]),
      repositories: [
        {
          id: "repo_1",
          fullName: "acme/widget",
          provider: "github",
          selected: row.selected ?? true,
          archived: false,
          setupStatus: started ? "configured" : "not_configured",
          setupNeedsAttention: row.setupNeedsAttention ?? false,
          installedWorkflowRequirement: started ? installed : null,
          workflowProvisioning: started
            ? {
                status: "configured",
                actionVersion: `777genius/review-router@${runtimeReadySha}`,
              }
            : null,
        },
      ],
      health: [
        {
          repositoryId: "repo_1",
          status: row.health ?? "healthy",
          latestActionHealthReceivedAt: reportedAt,
        },
      ],
      providerSetup: row.credential
        ? [
            {
              repositoryId: "repo_1",
              providerKind: "codex",
              authMode: "codex_subscription_oauth_rotating",
              state: "configured",
              updatedAt: reportedAt,
            },
          ]
        : [],
      hostedRepositories: [],
      gatewayAccounts: undefined,
      gatewayReadiness: new Map(),
      runtimeReleases,
      providerSecretCheckFailedRepositoryFullName: null,
    });
    return result!.state;
  }

  it.each<readonly [string, Row, string]>([
    ["a confirmed credential is ready", { credential: true }, "ready"],
    ["a merged workflow without its credential is setting up", {}, "setting_up"],
    [
      "an unhealthy provider needs attention",
      { credential: true, health: "provider_unhealthy" },
      "attention",
    ],
    [
      "a closed setup PR needs attention",
      { credential: true, setupNeedsAttention: true },
      "attention",
    ],
    [
      "an untouched repository is not set up",
      { started: false, health: "missing_workflow" },
      "not_set_up",
    ],
    [
      "an unselected repository leaves the counts",
      { selected: false, credential: true },
      "unavailable",
    ],
  ])("%s", (_name, row, expected) => {
    expect(stateOf(row)).toBe(expected);
  });
});
