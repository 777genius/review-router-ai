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
  forbiddenHeaderNames: ["host", "connection", "content-length", "content-type", "content-encoding", "accept", "transfer-encoding", "te", "trailer", "upgrade", "origin", "referer", "forwarded", "via"],
  forbiddenHeaderPrefixPattern: "^(proxy-|mcp-|x-forwarded-|x-real-|x-http-method|x-original-|x-rewrite-|x-host|x-proxy|x-mcp-)",
  runtimeEnvKey: "REVIEW_ROUTER_CONTEXT_TOOLS_PLAN_JSON",
  credentialsPath: "/api/action/v2/context-tools/credentials",
  githubIssuePath: "/api/action/v2/context-tools/github-issue",
  workflowSecret: "mcp_secrets_json",
  runnerSecretEnvKey: "REVIEWROUTER_MCP_CREDENTIALS_JSON",
  limits: {startupTimeoutMs:30000,callTimeoutMs:30000,responseBytes:1048576,maxCalls:128},
} as const);

export type ContextToolsPlanV1 = Readonly<{
  version: 1;
  builtinTools: readonly ("github.issue.read" | "repository.docs.read")[];
  servers: readonly Readonly<{
    id: string; version: number; url: string;
    headers: Readonly<Record<string, string>>;
    tools: readonly string[];
    credentials: Readonly<Record<string,
      | Readonly<{source:"github-secret";name:string}>
      | Readonly<{source:"dashboard-secret";credentialRef:string;version:number}>
    >>;
  }>[];
  limits: typeof contextToolsContract.limits;
  planDigest: string;
}>;
