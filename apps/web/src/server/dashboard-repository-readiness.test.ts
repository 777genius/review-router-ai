import {
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { describe, expect, it } from "vitest";
import { resolveDashboardRepositoryReadiness } from "./dashboard-repository-readiness";

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
