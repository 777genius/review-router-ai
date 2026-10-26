export const reviewModelWireProtocols = [
  "openai-responses",
  "codex-responses",
  "anthropic-messages",
] as const;
export type ReviewModelWireProtocol = (typeof reviewModelWireProtocols)[number];
export type ReviewModelOutputTokenLimit =
  | "upstream_request"
  | "terminal_acceptance";
export const anthropicModelAliases = ["sonnet", "opus", "haiku"] as const;
export type AnthropicModelAlias = (typeof anthropicModelAliases)[number];

/** Versioned metadata admission. Provider credentials and prompt/response bytes
 * remain in their existing transport; only bounded receipts enter this API. */
export const reviewModelDispatchContract = Object.freeze({
  extensionId: "review-model-dispatch.v2",
  version: 2,
  policyVersion: "model-dispatch-policy.v2",
  capabilityRuntimeEnvKey: "REVIEW_ROUTER_MODEL_DISPATCH_CAPABILITY_JSON",
  basePath: "/api/action/v2/model-dispatch",
  claimPath: "/api/action/v2/model-dispatch/claim",
  receiptHeader: "x-reviewrouter-dispatch-receipt",
  wireProtocols: Object.freeze(reviewModelWireProtocols),
  anthropicModelAliases: Object.freeze(anthropicModelAliases),
  outputTokenLimits: Object.freeze([
    "upstream_request",
    "terminal_acceptance",
  ] as const),
  maxRequests: 32,
  maxConcurrentRequests: 1,
  maxRequestBytes: 16 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  maxOutputTokens: 32_768,
  maxReceiptBytes: 8 * 1024,
} as const);

export const reviewModelDispatchDescriptorDigest =
  "sha256:be55241ba86af0788b6a60973ac7c55e6aa33244d18bba52a230cbc195ba4a2d";

/** Native forwarding supplements the existing parent-only lease headers. */
export const reviewModelDispatchHeaders = Object.freeze({
  dispatchVersion: "x-reviewrouter-model-dispatch-version",
  requestOrdinal: "x-reviewrouter-model-request-ordinal",
  routeIdentityHash: "x-reviewrouter-model-route-identity-hash",
} as const);

export const reviewModelTransports = [
  "runner_local_responses",
  "runner_local_anthropic",
  "account_gateway",
  "hosted_pool",
] as const;
export type ReviewModelTransport = (typeof reviewModelTransports)[number];

export type ReviewModelDispatchLimitsV2 = Readonly<{
  maxRequests: number;
  maxConcurrentRequests: 1;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}>;

/** A trusted producer approves finite protocols and explicit defaults. Retained
 * historical agent profiles never compete for implicit default selection. */
export type ReviewModelDispatchProfileV2 = Readonly<{
  extensionId: "review-model-dispatch.v2";
  descriptorDigest: string;
  policyVersion: "model-dispatch-policy.v2";
  transports: readonly ReviewModelTransport[];
  wireProtocols: readonly ReviewModelWireProtocol[];
  /** Exact native IDs qualified with this immutable producer, never a lookup
   * against mutable CLI aliases or current account defaults at execution time. */
  anthropicModelAliases?: Readonly<
    Partial<Record<AnthropicModelAlias, string>>
  >;
  defaultAgentProfileRefs: Readonly<
    Partial<Record<ReviewModelTransport, string>>
  >;
  limits: ReviewModelDispatchLimitsV2;
}>;

export type ReviewModelDispatchCapabilityV2 = ReviewModelDispatchLimitsV2 &
  Readonly<{
    extensionId: "review-model-dispatch.v2";
    version: 2;
    routeIdentityHash: string;
    transport: ReviewModelTransport;
    wireProtocol: ReviewModelWireProtocol;
    /** Codex subscription has no provider-enforced output-token field. */
    outputTokenLimit: ReviewModelOutputTokenLimit;
    providerIndex: number;
    model: string;
    configuredModel?: AnthropicModelAlias;
    deadline: string;
  }>;

/** This parent-only context never reaches the review engine or upstream. */
export type ReviewModelDispatchClaimV2 = Readonly<{
  dispatchVersion: 2;
  dispatchId: string;
  executionId: string;
  workSlotId: string;
  attemptOrdinal: 1;
  requestOrdinal: number;
  leaseId: string;
  leaseCapability: string;
  fencingToken: string;
  preparedManifestKey: string;
  routeIdentityHash: string;
  providerRequestEnvelopeHash: string;
  requestBytes: number;
  maxOutputTokens: number;
}>;

export type ReviewModelDispatchState =
  | "dispatch_may_have_started"
  | "effect_unknown"
  | "completed"
  | "not_dispatched";
export type ReviewModelDispatchRole =
  | "finding_discovery"
  | "lifecycle_verification"
  | "pr_description";

export type ReviewModelDispatchTerminalReceiptV2 = Readonly<{
  version: 2;
  routeIdentityHash: string;
  providerRequestEnvelopeHash: string;
  actualModel: string;
  responseHash: string;
  responseBytes: number;
  fullyConsumed: true;
  terminal: "completed";
  usage: Readonly<{
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  }>;
}>;

export type ReviewModelDispatchSettlementV2 =
  | Readonly<{
      state: "completed";
      receipt: ReviewModelDispatchTerminalReceiptV2;
    }>
  | Readonly<{ state: "not_dispatched"; proof: "local_before_forward" }>
  | Readonly<{ state: "effect_unknown" }>;

export type ReviewModelDispatchReadbackV2 = Readonly<{
  dispatchVersion: 2;
  authorizationId: string;
  dispatchId: string;
  executionId: string;
  workSlotId: string;
  attemptOrdinal: number;
  requestOrdinal: number;
  leaseId: string;
  fencingToken: string;
  preparedManifestKey: string;
  routeIdentityHash: string;
  providerRequestEnvelopeHash: string;
  nativeRequestRef: string;
  role: ReviewModelDispatchRole;
  state: ReviewModelDispatchState;
  requestBytes: number;
  maxOutputTokens: number;
  terminalReceipt: ReviewModelDispatchTerminalReceiptV2 | null;
}>;

export type ReviewModelDispatchClaimResultV2 =
  | Readonly<{
      status: "claimed";
      dispatch: ReviewModelDispatchReadbackV2;
      notAfter: string;
      receiptToken: string;
    }>
  | Readonly<{
      status: "restored";
      dispatch: ReviewModelDispatchReadbackV2;
      notAfter: string;
    }>;

/** The caller hashes these exact UTF-8 bytes with SHA-256 and prefixes the hex
 * result with rr-model-. Request hash and mutable lease identity are excluded:
 * changing either at the same ordinal conflicts with the original reservation. */
export function reviewModelDispatchIdPreimage(
  input: Readonly<{
    authorizationId: string;
    workSlotId: string;
    attemptOrdinal: number;
    requestOrdinal: number;
  }>,
): string {
  return JSON.stringify([
    reviewModelDispatchContract.extensionId,
    input.authorizationId,
    input.workSlotId,
    input.attemptOrdinal,
    input.requestOrdinal,
  ]);
}

export function parseReviewModelDispatchLimitsV2(
  value: unknown,
): ReviewModelDispatchLimitsV2 {
  const names = [
    "maxRequests",
    "maxConcurrentRequests",
    "maxRequestBytes",
    "maxResponseBytes",
    "maxOutputTokens",
  ] as const;
  if (!record(value) || !keys(value, names)) invalid();
  for (const name of names)
    if (
      !positive(value[name]) ||
      value[name] > reviewModelDispatchContract[name]
    )
      invalid();
  if (value.maxConcurrentRequests !== 1) invalid();
  return Object.freeze({ ...value }) as ReviewModelDispatchLimitsV2;
}

export function parseReviewModelDispatchProfileV2(
  value: unknown,
): ReviewModelDispatchProfileV2 {
  if (
    !record(value) ||
    !keys(value, [
      "extensionId",
      "descriptorDigest",
      "policyVersion",
      "transports",
      "wireProtocols",
      ...(Object.hasOwn(value, "anthropicModelAliases")
        ? ["anthropicModelAliases"]
        : []),
      "defaultAgentProfileRefs",
      "limits",
    ]) ||
    value.extensionId !== reviewModelDispatchContract.extensionId ||
    value.descriptorDigest !== reviewModelDispatchDescriptorDigest ||
    value.policyVersion !== reviewModelDispatchContract.policyVersion ||
    !Array.isArray(value.transports) ||
    value.transports.length < 1 ||
    value.transports.length > reviewModelTransports.length ||
    value.transports.some((item) => !isReviewModelTransport(item)) ||
    new Set(value.transports).size !== value.transports.length ||
    !Array.isArray(value.wireProtocols) ||
    value.wireProtocols.length < 1 ||
    value.wireProtocols.length > reviewModelWireProtocols.length ||
    value.wireProtocols.some((item) => !isReviewModelWireProtocol(item)) ||
    new Set(value.wireProtocols).size !== value.wireProtocols.length ||
    !record(value.defaultAgentProfileRefs) ||
    !keys(value.defaultAgentProfileRefs, value.transports)
  )
    invalid();
  for (const ref of Object.values(value.defaultAgentProfileRefs))
    if (
      typeof ref !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(ref)
    )
      invalid();
  if (Object.hasOwn(value, "anthropicModelAliases")) {
    const aliases = value.anthropicModelAliases;
    if (
      !record(aliases) ||
      Object.keys(aliases).length < 1 ||
      !value.transports.includes("runner_local_anthropic") ||
      !value.wireProtocols.includes("anthropic-messages") ||
      Object.entries(aliases).some(
        ([alias, model]) =>
          !(anthropicModelAliases as readonly string[]).includes(alias) ||
          typeof model !== "string" ||
          !/^claude-[a-z0-9][a-z0-9.-]{0,119}$/.test(model) ||
          model.endsWith("-latest"),
      )
    )
      invalid();
  }
  return Object.freeze({
    extensionId: reviewModelDispatchContract.extensionId,
    descriptorDigest: reviewModelDispatchDescriptorDigest,
    policyVersion: reviewModelDispatchContract.policyVersion,
    transports: Object.freeze([
      ...value.transports,
    ]) as readonly ReviewModelTransport[],
    wireProtocols: Object.freeze([
      ...value.wireProtocols,
    ]) as readonly ReviewModelWireProtocol[],
    ...(value.anthropicModelAliases === undefined
      ? {}
      : {
          anthropicModelAliases: Object.freeze({
            ...(value.anthropicModelAliases as Record<string, string>),
          }),
        }),
    defaultAgentProfileRefs: Object.freeze({
      ...value.defaultAgentProfileRefs,
    }),
    limits: parseReviewModelDispatchLimitsV2(value.limits),
  }) as ReviewModelDispatchProfileV2;
}

export function parseReviewModelDispatchCapabilityV2(
  value: unknown,
): ReviewModelDispatchCapabilityV2 {
  if (
    !record(value) ||
    !keys(value, [
      "extensionId",
      "version",
      "routeIdentityHash",
      "transport",
      "wireProtocol",
      "outputTokenLimit",
      "providerIndex",
      "model",
      ...(Object.hasOwn(value, "configuredModel") ? ["configuredModel"] : []),
      "deadline",
      "maxRequests",
      "maxConcurrentRequests",
      "maxRequestBytes",
      "maxResponseBytes",
      "maxOutputTokens",
    ]) ||
    value.extensionId !== reviewModelDispatchContract.extensionId ||
    value.version !== 2 ||
    !hash(value.routeIdentityHash) ||
    !isReviewModelTransport(value.transport) ||
    !isReviewModelWireProtocol(value.wireProtocol) ||
    (value.outputTokenLimit !== "upstream_request" &&
      value.outputTokenLimit !== "terminal_acceptance") ||
    (value.wireProtocol === "codex-responses" &&
      value.outputTokenLimit !== "terminal_acceptance") ||
    (value.wireProtocol === "anthropic-messages" &&
      value.outputTokenLimit !== "upstream_request") ||
    !reviewModelWireProtocolMatchesTransport(
      value.transport,
      value.wireProtocol,
    ) ||
    !Number.isSafeInteger(value.providerIndex) ||
    Number(value.providerIndex) < 0 ||
    Number(value.providerIndex) > 15 ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 256 ||
    (Object.hasOwn(value, "configuredModel") &&
      (value.transport !== "runner_local_anthropic" ||
        !(anthropicModelAliases as readonly unknown[]).includes(
          value.configuredModel,
        ) ||
        value.configuredModel === value.model)) ||
    typeof value.deadline !== "string" ||
    !Number.isFinite(Date.parse(value.deadline)) ||
    new Date(value.deadline).toISOString() !== value.deadline
  )
    invalid();
  const {
    maxRequests,
    maxConcurrentRequests,
    maxRequestBytes,
    maxResponseBytes,
    maxOutputTokens,
  } = value;
  const limits = parseReviewModelDispatchLimitsV2({
    maxRequests,
    maxConcurrentRequests,
    maxRequestBytes,
    maxResponseBytes,
    maxOutputTokens,
  });
  return Object.freeze({
    ...value,
    ...limits,
  }) as ReviewModelDispatchCapabilityV2;
}

export function isReviewModelTransport(
  value: unknown,
): value is ReviewModelTransport {
  return (
    typeof value === "string" &&
    (reviewModelTransports as readonly string[]).includes(value)
  );
}

export function isReviewModelWireProtocol(
  value: unknown,
): value is ReviewModelWireProtocol {
  return (
    typeof value === "string" &&
    (reviewModelWireProtocols as readonly string[]).includes(value)
  );
}

export function reviewModelWireProtocolMatchesTransport(
  transport: ReviewModelTransport,
  protocol: ReviewModelWireProtocol,
): boolean {
  switch (transport) {
    case "runner_local_anthropic":
      return protocol === "anthropic-messages";
    case "hosted_pool":
      return protocol === "codex-responses";
    case "account_gateway":
      return protocol === "openai-responses";
    case "runner_local_responses":
      return protocol === "openai-responses" || protocol === "codex-responses";
  }
}

/** A terminal receipt must prove its output bound, even where the transport's
 * field is only an outer-hop request or subscription acceptance ceiling. */
export function reviewModelDispatchOutputUsageIsWithinLimit(
  usage: Readonly<{ outputTokens: number | null }>,
  maxOutputTokens: number,
): boolean {
  return (
    typeof usage.outputTokens === "number" &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    Number.isSafeInteger(maxOutputTokens) &&
    maxOutputTokens > 0 &&
    usage.outputTokens <= maxOutputTokens
  );
}

export function parseReviewModelDispatchClaimV2(
  value: unknown,
): ReviewModelDispatchClaimV2 {
  if (
    !record(value) ||
    !keys(value, [
      "dispatchVersion",
      "dispatchId",
      "executionId",
      "workSlotId",
      "attemptOrdinal",
      "requestOrdinal",
      "leaseId",
      "leaseCapability",
      "fencingToken",
      "preparedManifestKey",
      "routeIdentityHash",
      "providerRequestEnvelopeHash",
      "requestBytes",
      "maxOutputTokens",
    ]) ||
    value.dispatchVersion !== 2 ||
    value.attemptOrdinal !== 1 ||
    typeof value.dispatchId !== "string" ||
    !/^rr-model-[a-f0-9]{64}$/.test(value.dispatchId) ||
    !positive(value.requestOrdinal) ||
    value.requestOrdinal > reviewModelDispatchContract.maxRequests ||
    !positive(value.requestBytes) ||
    value.requestBytes > reviewModelDispatchContract.maxRequestBytes ||
    !positive(value.maxOutputTokens) ||
    value.maxOutputTokens > reviewModelDispatchContract.maxOutputTokens ||
    !hash(value.routeIdentityHash) ||
    !hash(value.providerRequestEnvelopeHash) ||
    typeof value.fencingToken !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value.fencingToken) ||
    typeof value.leaseCapability !== "string" ||
    !value.leaseCapability ||
    value.leaseCapability.length > 16_384
  )
    invalid();
  for (const name of [
    "executionId",
    "workSlotId",
    "leaseId",
    "preparedManifestKey",
  ])
    if (
      typeof value[name] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value[name] as string)
    )
      invalid();
  return Object.freeze({ ...value }) as ReviewModelDispatchClaimV2;
}

export function parseReviewModelDispatchSettlementV2(
  value: unknown,
): ReviewModelDispatchSettlementV2 {
  if (!record(value)) invalid();
  if (value.state === "effect_unknown" && keys(value, ["state"]))
    return { state: "effect_unknown" };
  if (
    value.state === "not_dispatched" &&
    keys(value, ["state", "proof"]) &&
    value.proof === "local_before_forward"
  )
    return { state: "not_dispatched", proof: "local_before_forward" };
  if (
    value.state !== "completed" ||
    !keys(value, ["state", "receipt"]) ||
    !record(value.receipt)
  )
    invalid();
  const receipt = value.receipt;
  if (
    !keys(receipt, [
      "version",
      "routeIdentityHash",
      "providerRequestEnvelopeHash",
      "actualModel",
      "responseHash",
      "responseBytes",
      "fullyConsumed",
      "terminal",
      "usage",
    ]) ||
    receipt.version !== 2 ||
    !hash(receipt.routeIdentityHash) ||
    !hash(receipt.providerRequestEnvelopeHash) ||
    !hash(receipt.responseHash) ||
    typeof receipt.actualModel !== "string" ||
    !receipt.actualModel.trim() ||
    receipt.actualModel.length > 256 ||
    !positive(receipt.responseBytes) ||
    receipt.responseBytes > reviewModelDispatchContract.maxResponseBytes ||
    receipt.fullyConsumed !== true ||
    receipt.terminal !== "completed" ||
    !record(receipt.usage) ||
    !keys(receipt.usage, ["inputTokens", "outputTokens", "totalTokens"])
  )
    invalid();
  for (const n of Object.values(receipt.usage))
    if (
      n !== null &&
      (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    )
      invalid();
  return {
    state: "completed",
    receipt: Object.freeze({
      ...receipt,
      usage: Object.freeze({ ...receipt.usage }),
    }) as ReviewModelDispatchTerminalReceiptV2,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(
  value: Record<string, unknown>,
  names: readonly string[],
): boolean {
  return (
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function invalid(): never {
  throw new Error("review_model_dispatch_contract_invalid");
}
