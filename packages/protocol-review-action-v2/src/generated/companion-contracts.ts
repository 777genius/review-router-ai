// Generated from shared/src/review-action-companion-contracts.ts. Do not edit.
/** Finite direct-provider transport metadata, shared with the public runtime. */
export const providerApiAuthModes = [
  "openrouter-api",
  "mimo-token-plan-api",
  "kimi-code-api",
] as const;
export type ProviderApiAuthMode = (typeof providerApiAuthModes)[number];
export const providerApiDescriptors = Object.freeze({
  "openrouter-api": Object.freeze({
    providerKind: "openrouter",
    authMode: "openrouter_api_key",
    runtimePrefix: "openrouter",
    secretName: "OPENROUTER_API_KEY",
    fixedResponsesUrl: "https://openrouter.ai/api/v1/responses",
    defaultModel: "openai/gpt-5.3-codex",
  }),
  "mimo-token-plan-api": Object.freeze({
    providerKind: "codex-mimo",
    authMode: "mimo_token_plan_api_key",
    runtimePrefix: "codex-mimo",
    secretName: "MIMO_TOKEN_PLAN_API_KEY",
    fixedResponsesUrl: "https://token-plan-sgp.xiaomimimo.com/v1/responses",
    defaultModel: "mimo-v2.6-pro",
  }),
  "kimi-code-api": Object.freeze({
    providerKind: "kimi",
    authMode: "kimi_code_api_key",
    runtimePrefix: "kimi",
    secretName: "KIMI_CODE_API_KEY",
    fixedResponsesUrl: "https://api.kimi.ai/coding/v1/responses",
    defaultModel: "k3-256k",
  }),
} as const);
export function isProviderApiAuthMode(
  value: unknown,
): value is ProviderApiAuthMode {
  return (
    typeof value === "string" && Object.hasOwn(providerApiDescriptors, value)
  );
}

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

/** Explicit parent-owned lifecycle inference; never discovery-engine output. */
export const lifecycleVerificationContract = Object.freeze({
  extensionId: "lifecycle-verification.v1",
  executor: "rr_bounded_lifecycle_verifier.v1",
  version: 1,
  taskKind: "lifecycle_revalidation",
  modelTransport: "account_gateway",
  capabilityRuntimeEnvKey:
    "REVIEW_ROUTER_LIFECYCLE_VERIFICATION_CAPABILITY_JSON",
  unavailableReasonRuntimeEnvKey:
    "REVIEW_ROUTER_LIFECYCLE_VERIFICATION_UNAVAILABLE_REASON",
  promptVersion: "lifecycle-verification-prompt.v1",
  outputSchemaVersion: 1,
  requestCanonicalizerVersion: "lifecycle-verification-request.v1",
  policyVersion: "lifecycle-verification-policy.v1",
  dispatchReadbackPath: "/api/action/v2/account-gateway/companion-dispatch",
  maxTargetsPerPacket: 4,
  maxPackets: 2,
  maxFilesPerPacket: 6,
  maxFileBytes: 24 * 1024,
  maxSourceBytes: 64 * 1024,
  maxPromptBytes: 96 * 1024,
  maxClaimBytes: 4 * 1024,
  maxResponseBytes: 32 * 1024,
  maxLifecyclePlanBytes: 64 * 1024,
  maxOutputTokens: 4096,
  minOutputTokensPerTarget: 1024,
  deadlineMs: 60000,
  attemptBudget: 1,
  dispatchHeaders: Object.freeze({
    dispatchId: "x-reviewrouter-companion-dispatch-id",
    executionId: "x-reviewrouter-companion-execution-id",
    workSlotId: "x-reviewrouter-companion-work-slot-id",
    attemptOrdinal: "x-reviewrouter-companion-attempt-ordinal",
    leaseId: "x-reviewrouter-companion-lease-id",
    leaseCapability: "x-reviewrouter-companion-lease-capability",
    fencingToken: "x-reviewrouter-companion-fencing-token",
    preparedManifestKey: "x-reviewrouter-companion-prepared-manifest-key",
  }),
} as const);

/** SHA-256 of canonical JSON for lifecycleVerificationContract (no digest field). */
export const lifecycleVerificationDescriptorDigest =
  "sha256:ac66b0d04cb2cc26ba5dc2a65c59a8d39cbd248bef426a25d249c96d141cf720";

export type LifecycleVerificationCapabilityV1 = Readonly<{
  extensionId: "lifecycle-verification.v1";
  descriptorDigest: string;
  executor: "rr_bounded_lifecycle_verifier.v1";
  modelTransport: "account_gateway";
  providerIndex: number;
  providerKind: string;
  model: string;
  maxDispatches: 2;
  maxPromptBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
  deadlineMs: number;
  attemptBudget: 1;
}>;

export type LifecycleVerificationEvidenceV1 = Readonly<{
  path: string;
  blobOid: string;
  startLine: number;
  endLine: number;
  quote: string;
  reason: string;
}>;

export type LifecycleVerificationResultV1 = Readonly<{
  targetId: string;
  fingerprint: string;
  verdict: "resolved" | "still_valid" | "uncertain";
  confidence: number;
  scopeSufficient: boolean;
  failureCondition: string;
  fixExplanation: string;
  evidence: readonly LifecycleVerificationEvidenceV1[];
}>;

export type LifecycleVerificationOutputV1 = Readonly<{
  version: 1;
  packetHash: string;
  results: readonly LifecycleVerificationResultV1[];
}>;

/** The lease capability stays parent-only and is never forwarded to the model. */
export type ReviewCompanionDispatchContextV1 = Readonly<{
  dispatchId: string;
  executionId: string;
  workSlotId: string;
  attemptOrdinal: number;
  leaseId: string;
  leaseCapability: string;
  fencingToken: string;
  preparedManifestKey: string;
}>;

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

/** Non-secret, captured OCR-parent contract; absent on older producers. */
export const contextToolsContract = Object.freeze({
  extensionId: "context-tools.v1",
  version: 1,
  planVersion: 1,
  engine: "ocr",
  modelTransport: "account_gateway",
  availability: "required",
  credentialDelivery: "explicit-run-scoped",
  maxPlanBytes: 16384,
  maxServers: 4,
  maxToolsPerServer: 20,
  maxHeadersPerServer: 16,
  maxHeaderValueChars: 4096,
  maxCredentialBindingsPerServer: 16,
  maxCredentialBytes: 8192,
  maxCredentialMapBytes: 65536,
  headerNamePattern: "^[A-Za-z][!#$%&'*+.^_`|~0-9A-Za-z-]{0,63}$",
  forbiddenHeaderNames: [
    "host",
    "connection",
    "content-length",
    "content-type",
    "content-encoding",
    "accept",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "origin",
    "referer",
    "forwarded",
    "via",
  ],
  forbiddenHeaderPrefixPattern:
    "^(proxy-|mcp-|x-forwarded-|x-real-|x-http-method|x-original-|x-rewrite-|x-host|x-proxy|x-mcp-)",
  runtimeEnvKey: "REVIEW_ROUTER_CONTEXT_TOOLS_PLAN_JSON",
  credentialsPath: "/api/action/v2/context-tools/credentials",
  githubIssuePath: "/api/action/v2/context-tools/github-issue",
  workflowSecret: "mcp_secrets_json",
  runnerSecretEnvKey: "REVIEWROUTER_MCP_CREDENTIALS_JSON",
  limits: {
    startupTimeoutMs: 30000,
    callTimeoutMs: 30000,
    responseBytes: 1048576,
    maxCalls: 128,
  },
} as const);

export type ContextToolsPlanV1 = Readonly<{
  version: 1;
  builtinTools: readonly ("github.issue.read" | "repository.docs.read")[];
  servers: readonly Readonly<{
    id: string;
    version: number;
    url: string;
    headers: Readonly<Record<string, string>>;
    tools: readonly string[];
    credentials: Readonly<
      Record<
        string,
        | Readonly<{ source: "github-secret"; name: string }>
        | Readonly<{
            source: "dashboard-secret";
            credentialRef: string;
            version: number;
          }>
      >
    >;
  }>[];
  limits: typeof contextToolsContract.limits;
  planDigest: string;
}>;
