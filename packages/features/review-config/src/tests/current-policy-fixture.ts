import { parseReviewConfigurationStrict } from "../domain/review-configuration";

export const workspaceProviderFixture = {
  kind: "codex",
  authMode: "codex_subscription_oauth_rotating",
  model: "gpt-5.5",
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

export const workspacePolicyFixture = parseReviewConfigurationStrict({
  schemaVersion: 3,
  providers: [workspaceProviderFixture],
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
