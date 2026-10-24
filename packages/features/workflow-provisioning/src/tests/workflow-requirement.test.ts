import {
  mapConfigToRuntimeEnv,
  parseReviewConfigurationStrict,
  type ReviewProviderConfiguration,
} from "@reviewrouter/features-review-config";
import { describe, expect, it } from "vitest";
import {
  renderedWorkflowRequirement,
  requiredWorkflowRequirement,
  requiredWorkflowTransport,
} from "../domain/workflow-transport";

const settings = {
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

function config(providers: readonly ReviewProviderConfiguration[]) {
  return parseReviewConfigurationStrict({
    schemaVersion: 3,
    providers,
    execution: {
      providerLimit: providers.length,
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

const claude = config([
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    ...settings,
  },
]);
const mimo = config([
  {
    kind: "codex-mimo",
    authMode: "mimo_token_plan_api_key",
    model: "mimo-v2.6-pro",
    ...settings,
  },
]);
const hybridRotating = config([
  {
    kind: "codex",
    authMode: "codex_subscription_oauth_rotating",
    model: "gpt-5.6-sol",
    ...settings,
  },
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    ...settings,
    requiredHealthy: false,
  },
]);

describe("workflow requirement", () => {
  it("tells CI-secret workflows of different secret providers apart", () => {
    // Both use GitHub secrets, but only the MiMo workflow forwards its key.
    expect(requiredWorkflowTransport(claude)).toBe("ci_secrets");
    expect(requiredWorkflowTransport(mimo)).toBe("ci_secrets");
    expect(requiredWorkflowRequirement(claude)).toBe("ci_secrets+claude");
    expect(requiredWorkflowRequirement(mimo)).toBe("ci_secrets+codex-mimo");
    expect(requiredWorkflowRequirement(hybridRotating)).toBe("rotating+claude");
  });

  it("records for an attempt what its rendered workflow requires", () => {
    for (const candidate of [claude, mimo, hybridRotating])
      expect(
        renderedWorkflowRequirement(
          requiredWorkflowTransport(candidate),
          mapConfigToRuntimeEnv(candidate),
        ),
      ).toBe(requiredWorkflowRequirement(candidate));
  });
});
