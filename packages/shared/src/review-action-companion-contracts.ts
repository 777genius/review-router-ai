/** Bearer-authorized read-only companion, outside the V2 command envelope. */
export const providerApiCheckoutCompanionContract = Object.freeze({
  path: "/api/action/v2/provider-api/checkout",
  providerApiAuthMode: "openrouter-api",
  workflowSchemaVersion: 2,
} as const);

/** One optional parent-stage invocation; never finding evidence or quorum. */
export const prDescriptionContract = Object.freeze({
  taskKind: "pr_description",
  runtimeEnvKey: "UPDATE_PR_DESCRIPTION",
  capabilityRuntimeEnvKey: "REVIEW_ROUTER_PR_DESCRIPTION_CAPABILITY_JSON",
  promptVersion: "pr-description-v1",
  outputSchemaVersion: 1,
  maxPromptBytes: 32768,
  maxGeneratedMarkdownBytes: 8192,
  maxOutputTokens: 1200,
  deadlineMs: 60000,
  attemptBudget: 1,
} as const);

export type PrDescriptionGenerationProvenance = Readonly<{
  leaseId: string;
  providerIndex: number;
  requestedModel: string;
  actualModel: string;
  providerRequestEnvelopeHash: string;
}>;

export type GeneratedPrDescription = Readonly<{
  generatedMarkdown: string;
  generationProvenance: PrDescriptionGenerationProvenance;
}>;

/** Local parent-stage outcome; omission never changes required review coverage. */
export type PrDescriptionStageOutcome =
  | Readonly<{ status: "generated"; description: GeneratedPrDescription }>
  | Readonly<{
      status: "omitted";
      reason:
        | "disabled"
        | "unavailable"
        | "request_too_large"
        | "budget_unavailable"
        | "deadline"
        | "provider_failed"
        | "effect_unknown";
    }>;
