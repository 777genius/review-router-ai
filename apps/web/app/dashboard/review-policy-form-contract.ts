/** Explicit repository override fields; no value comparison decides inheritance. */
export const repositoryPolicyFormFields = [
  ["providers"],
  ["execution", "providerMaxParallel"],
  ["execution", "inlineMinAgreement"],
  ["blockingPolicy", "failOnSeverity"],
  ["limits", "inlineMaxComments"],
  ["limits", "targetTokensPerBatch"],
  ["reviewLanguage"],
  ["contextTools"],
  ["updatePrDescription"],
  ["investigationRollout", "recordingEnabled"],
  ["investigationRollout", "shadowEnabled"],
  ["investigationRollout", "contextCriticEnabled"],
  ["investigationRollout", "verifiedCleanEnabled"],
  ["investigationRollout", "crossRevisionReplayEnabled"],
  ["investigationRollout", "productionEffectsEnabled"],
] as const;
