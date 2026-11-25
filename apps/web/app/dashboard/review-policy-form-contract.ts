/**
 * Explicit repository override fields; no value comparison decides
 * inheritance. Providers are not among them: a repository's provider is
 * chosen in the provider dialog.
 */
export const repositoryPolicyFormFields = [
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
