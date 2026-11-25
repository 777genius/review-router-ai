import type {
  ReviewConfiguration,
  ReviewProviderConfiguration,
} from "../../../packages/features/review-config/src/index.ts";

/** Explicit test policy; production admission never supplies a missing policy. */
export function reviewPolicyFixture(
  providers: ReviewProviderConfiguration[],
): ReviewConfiguration {
  return {
    schemaVersion: 3,
    providers,
    execution: {
      providerLimit: providers.length,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
    blockingPolicy: { failOnSeverity: "major" },
    limits: { inlineMaxComments: 5, targetTokensPerBatch: 12000 },
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
}
export const fixtureProviderSettings = {
  reasoningEffort: "medium" as const,
  agenticContext: true,
  fastMode: false,
  requiredHealthy: false,
};
