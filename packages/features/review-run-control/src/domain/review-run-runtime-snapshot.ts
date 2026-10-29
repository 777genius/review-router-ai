import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  type LifecycleVerificationCapability,
  parseLifecycleVerificationCapabilityV2,
  parseReviewModelDispatchCapabilityV2,
  type ReviewModelDispatchCapabilityV2,
  reviewModelTransportForAuthMode,
} from "@reviewrouter/shared";
import { reviewAgentExecutionProviderKind } from "./review-agent-profile";
import {
  canonicalJson,
  assertIdentifier,
  assertCommitSha,
  assertSha256,
} from "./review-run-control-types";
import {
  parseReviewAgentProfiles,
  type ReviewAgentProfile,
} from "./review-agent-profile";

import {
  parseProducerPrDescriptionProfile,
  type ProducerPrDescriptionProfile,
} from "./producer-release";

/** Private admission data. Never included in public authorization claims/facts. */
export type ReviewRunRuntimeSnapshot = {
  readonly snapshotVersion: 3;
  readonly lifecycleVerificationUnavailableReason?:
    | "verification_configuration_invalid"
    | "verification_unavailable";
  readonly lifecycleVerificationCapability?: LifecycleVerificationCapability;
  readonly modelDispatchCapability?: ReviewModelDispatchCapabilityV2;
  readonly prDescriptionCapability?: ProducerPrDescriptionProfile;
  readonly configurationSource: "workspace" | "repository";
  readonly configurationVersion: number;
  readonly workspaceConfigurationVersion: number;
  readonly repositoryConfigurationVersion: number | null;
  readonly effectivePolicyDigest: string;
  readonly agent: ReviewAgentProfile;
  readonly agentProfileDigest: string;
  readonly producer: Readonly<{
    producerReleaseId: string;
    actionCommitSha: string;
    runtimeCommitSha: string;
  }>;
  /** Opaque normalized safe configuration; production uses the shared strict parser. */
  readonly configurationCanonicalJson: string;
  /** Non-secret canonical captured tool plan; absent preserves pre-MCP snapshots. */
  readonly contextToolsPlanCanonicalJson?: string;
  readonly deadline: string;
  readonly gateway: ReviewRunGatewaySelection | null;
  /** Original Hosted grant identity; no token or credential material. */
  readonly hosted?: ReviewRunHostedSelection;
};

export type ReviewRunHostedSelection = Readonly<{
  grantId: string;
  invocationId: string;
  poolId: string;
  repositoryBindingId: string;
  activeAccountId: string;
  reviewRequestId: string;
  providerInvocationKey: string;
  policyFingerprint: string;
  model: string;
  expiresAt: string;
  bindingRevision: number;
  runtimeConfigVersion: number;
  authzEpoch: string;
  runtimeAuthzEpoch: string;
}>;

export function parseReviewRunHostedSelection(
  value: unknown,
): ReviewRunHostedSelection {
  const names = [
    "grantId",
    "invocationId",
    "poolId",
    "repositoryBindingId",
    "activeAccountId",
    "reviewRequestId",
    "providerInvocationKey",
    "policyFingerprint",
    "model",
    "expiresAt",
    "bindingRevision",
    "runtimeConfigVersion",
    "authzEpoch",
    "runtimeAuthzEpoch",
  ];
  if (!record(value) || !keys(value, names)) fail();
  for (const name of [
    "grantId",
    "invocationId",
    "poolId",
    "repositoryBindingId",
    "activeAccountId",
    "reviewRequestId",
  ])
    if (!reference(value[name])) fail();
  for (const name of ["providerInvocationKey", "policyFingerprint"])
    if (typeof value[name] !== "string" || !/^[a-f0-9]{64}$/.test(value[name]))
      fail();
  for (const name of ["authzEpoch", "runtimeAuthzEpoch"])
    if (
      typeof value[name] !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(value[name]) ||
      BigInt(value[name]) > 9_223_372_036_854_775_807n
    )
      fail();
  if (
    typeof value.bindingRevision !== "number" ||
    !Number.isSafeInteger(value.bindingRevision) ||
    value.bindingRevision < 1 ||
    !revision(value.runtimeConfigVersion) ||
    typeof value.model !== "string" ||
    !value.model ||
    value.model.trim() !== value.model ||
    value.model.length > 256 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    new Date(value.expiresAt).toISOString() !== value.expiresAt
  )
    fail();
  return Object.freeze({ ...value }) as ReviewRunHostedSelection;
}

/** An explicit captured epoch is binding on both initial selection and recovery. */
export function reviewRunGatewayEpochMatches(
  snapshot: ReviewRunRuntimeSnapshot,
  selectedEpoch: number,
): boolean {
  return (
    snapshot.gateway?.expectedAuthorizationEpoch === undefined ||
    snapshot.gateway.expectedAuthorizationEpoch === selectedEpoch
  );
}

/** Pure finite allowance data, independent of SDK/HTTP validation. */
export type ReviewRunGatewayLimits = {
  readonly requests: number;
  readonly concurrency: number;
  readonly requestBytes: number;
  readonly outputBytes: number;
  readonly tokens: number;
};

export function parseReviewRunGatewayLimits(
  value: unknown,
): ReviewRunGatewayLimits {
  const names = [
    "requests",
    "concurrency",
    "requestBytes",
    "outputBytes",
    "tokens",
  ] as const;
  if (!record(value) || !keys(value, names)) fail();
  for (const name of names) {
    const cap = value[name];
    if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 1)
      fail();
  }
  return {
    requests: Number(value.requests),
    concurrency: Number(value.concurrency),
    requestBytes: Number(value.requestBytes),
    outputBytes: Number(value.outputBytes),
    tokens: Number(value.tokens),
  };
}

/** Approved subset, not Gateway's selected-account/epoch result or a capability. */
export type ReviewRunGatewaySelection = {
  readonly providerIndex: number;
  readonly bindingId: string;
  readonly connectionId: string;
  readonly bindingRevision: number;
  readonly policySubject: string;
  readonly policyRevision: number;
  readonly permittedAccountRef: string;
  readonly profileRef: string;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly operationId: string;
  readonly limits: ReviewRunGatewayLimits;
  readonly expectedAuthorizationEpoch?: number;
};

export function parseReviewRunRuntimeSnapshot(
  value: string | null | undefined,
): ReviewRunRuntimeSnapshot | null {
  if (value === null || value === undefined) return null;
  if (new TextEncoder().encode(value).byteLength > 32_768) fail();
  const parsed: unknown = JSON.parse(value);
  if (
    !record(parsed) ||
    !keys(parsed, [
      "snapshotVersion",
      "configurationSource",
      "configurationVersion",
      "workspaceConfigurationVersion",
      "repositoryConfigurationVersion",
      "effectivePolicyDigest",
      "producer",
      "agent",
      "agentProfileDigest",
      "configurationCanonicalJson",
      "deadline",
      "gateway",
      ...(Object.hasOwn(parsed, "contextToolsPlanCanonicalJson")
        ? ["contextToolsPlanCanonicalJson"]
        : []),
      ...(Object.hasOwn(parsed, "hosted") ? ["hosted"] : []),
      ...("lifecycleVerificationUnavailableReason" in parsed
        ? ["lifecycleVerificationUnavailableReason"]
        : []),
      ...("lifecycleVerificationCapability" in parsed
        ? ["lifecycleVerificationCapability"]
        : []),
      ...("prDescriptionCapability" in parsed
        ? ["prDescriptionCapability"]
        : []),
      ...("modelDispatchCapability" in parsed
        ? ["modelDispatchCapability"]
        : []),
    ])
  )
    fail();
  const { configurationSource, configurationVersion, deadline } = parsed;
  if (
    parsed.snapshotVersion !== 3 ||
    (configurationSource !== "workspace" &&
      configurationSource !== "repository") ||
    !revision(configurationVersion) ||
    !revision(parsed.workspaceConfigurationVersion) ||
    (parsed.repositoryConfigurationVersion !== null &&
      !revision(parsed.repositoryConfigurationVersion)) ||
    typeof parsed.effectivePolicyDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(parsed.effectivePolicyDigest) ||
    configurationVersion !==
      (parsed.repositoryConfigurationVersion ??
        parsed.workspaceConfigurationVersion) ||
    (configurationSource === "workspace"
      ? parsed.repositoryConfigurationVersion !== null
      : parsed.repositoryConfigurationVersion === null) ||
    typeof deadline !== "string" ||
    !Number.isFinite(Date.parse(deadline)) ||
    new Date(deadline).toISOString() !== deadline
  )
    fail();
  const contextToolsPlanCanonicalJson = parsed.contextToolsPlanCanonicalJson;
  if (contextToolsPlanCanonicalJson !== undefined) {
    if (
      typeof contextToolsPlanCanonicalJson !== "string" ||
      new TextEncoder().encode(contextToolsPlanCanonicalJson).byteLength >
        16_384
    )
      fail();
    const plan: unknown = JSON.parse(contextToolsPlanCanonicalJson);
    if (
      !record(plan) ||
      plan.version !== 1 ||
      typeof plan.planDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(plan.planDigest) ||
      canonicalJson(plan) !== contextToolsPlanCanonicalJson
    )
      fail();
  }
  const configurationCanonicalJson = parsed.configurationCanonicalJson;
  if (
    typeof configurationCanonicalJson !== "string" ||
    new TextEncoder().encode(configurationCanonicalJson).byteLength > 24_576
  )
    fail();
  const configuration: unknown = JSON.parse(configurationCanonicalJson);
  if (
    !record(configuration) ||
    configuration.schemaVersion !== 3 ||
    canonicalJson(configuration) !== configurationCanonicalJson
  )
    fail();
  const producer = parsed.producer;
  if (
    !record(producer) ||
    !keys(producer, [
      "producerReleaseId",
      "actionCommitSha",
      "runtimeCommitSha",
    ])
  )
    fail();
  for (const name of [
    "producerReleaseId",
    "actionCommitSha",
    "runtimeCommitSha",
  ]) {
    if (typeof producer[name] !== "string") fail();
  }
  assertIdentifier(String(producer.producerReleaseId), "producer_release_id");
  assertCommitSha(String(producer.actionCommitSha), "action_commit_sha");
  assertCommitSha(String(producer.runtimeCommitSha), "runtime_commit_sha");
  const agent = parseReviewAgentProfiles([parsed.agent])[0]!;
  if (typeof parsed.agentProfileDigest !== "string") fail();
  assertSha256(parsed.agentProfileDigest, "review_agent_profile_digest");
  let gateway: ReviewRunGatewaySelection | null = null;
  if (parsed.gateway === null) {
    // Non-gateway model transports have no account binding.
  } else {
    const row = parsed.gateway;
    if (
      !record(row) ||
      !keys(row, [
        "providerIndex",
        "bindingId",
        "connectionId",
        "bindingRevision",
        "policySubject",
        "policyRevision",
        "permittedAccountRef",
        "profileRef",
        "invocationId",
        "attemptId",
        "operationId",
        "limits",
        ...("expectedAuthorizationEpoch" in row
          ? ["expectedAuthorizationEpoch"]
          : []),
      ])
    )
      fail();
    for (const key of [
      "bindingId",
      "connectionId",
      "policySubject",
      "permittedAccountRef",
      "profileRef",
      "invocationId",
      "attemptId",
      "operationId",
    ]) {
      if (!reference(row[key])) fail();
    }
    if (
      typeof row.providerIndex !== "number" ||
      !Number.isInteger(row.providerIndex) ||
      row.providerIndex < 0 ||
      row.providerIndex > 15 ||
      row.policySubject !== row.bindingId ||
      !revision(row.bindingRevision) ||
      !revision(row.policyRevision)
    )
      fail();
    if (
      "expectedAuthorizationEpoch" in row &&
      (typeof row.expectedAuthorizationEpoch !== "number" ||
        !Number.isSafeInteger(row.expectedAuthorizationEpoch) ||
        row.expectedAuthorizationEpoch < 1)
    )
      fail();
    // Fields were bounded/checked above; construct a detached primitive projection.
    gateway = {
      ...("expectedAuthorizationEpoch" in row
        ? { expectedAuthorizationEpoch: Number(row.expectedAuthorizationEpoch) }
        : {}),
      providerIndex: row.providerIndex,
      bindingId: String(row.bindingId),
      connectionId: String(row.connectionId),
      bindingRevision: row.bindingRevision,
      policySubject: String(row.policySubject),
      policyRevision: row.policyRevision,
      permittedAccountRef: String(row.permittedAccountRef),
      profileRef: String(row.profileRef),
      invocationId: String(row.invocationId),
      attemptId: String(row.attemptId),
      operationId: String(row.operationId),
      limits: parseReviewRunGatewayLimits(row.limits),
    };
  }
  const modelDispatchCapability =
    "modelDispatchCapability" in parsed
      ? parseReviewModelDispatchCapabilityV2(parsed.modelDispatchCapability)
      : undefined;
  const hosted = Object.hasOwn(parsed, "hosted")
    ? parseReviewRunHostedSelection(parsed.hosted)
    : undefined;
  if ((modelDispatchCapability?.transport === "hosted_pool") !== !!hosted)
    fail();
  if (modelDispatchCapability) {
    const cap = modelDispatchCapability;
    const provider = Array.isArray(configuration.providers)
      ? configuration.providers[cap.providerIndex]
      : undefined;
    if (
      !record(provider) ||
      !Array.isArray(configuration.providers) ||
      configuration.providers.length !== 1 ||
      typeof provider.authMode !== "string" ||
      reviewModelTransportForAuthMode(provider.authMode) !== cap.transport ||
      provider.model !== (cap.configuredModel ?? cap.model) ||
      Date.parse(cap.deadline) > Date.parse(deadline) ||
      (cap.transport === "account_gateway" &&
        (!gateway || gateway.providerIndex !== cap.providerIndex)) ||
      (cap.transport !== "account_gateway" && gateway !== null) ||
      (hosted &&
        (hosted.model !== cap.model ||
          Date.parse(cap.deadline) > Date.parse(hosted.expiresAt) - 60_000))
    )
      fail();
  }
  const lifecycleVerificationUnavailableReason =
    parsed.lifecycleVerificationUnavailableReason;
  if (
    lifecycleVerificationUnavailableReason !== undefined &&
    lifecycleVerificationUnavailableReason !==
      "verification_configuration_invalid" &&
    lifecycleVerificationUnavailableReason !== "verification_unavailable"
  )
    fail();
  if (
    lifecycleVerificationUnavailableReason !== undefined &&
    "lifecycleVerificationCapability" in parsed
  )
    fail();
  const lifecycleVerificationCapability =
    "lifecycleVerificationCapability" in parsed
      ? parseLifecycleVerificationCapability(
          parsed.lifecycleVerificationCapability,
        )
      : undefined;
  if (lifecycleVerificationCapability) {
    const cap = lifecycleVerificationCapability;
    const providers = configuration.providers;
    const provider = Array.isArray(providers)
      ? providers[cap.providerIndex]
      : null;
    if (
      !record(provider) ||
      provider.model !==
        (cap.extensionId === "lifecycle-verification.v2"
          ? (modelDispatchCapability?.configuredModel ?? cap.model)
          : cap.model) ||
      cap.providerKind !== reviewAgentExecutionProviderKind(agent) ||
      !["ocr", "codex"].includes(agent.agentKind)
    )
      fail();
    if (cap.extensionId === "lifecycle-verification.v2") {
      const route = modelDispatchCapability;
      if (
        !route ||
        cap.routeIdentityHash !== route.routeIdentityHash ||
        cap.modelTransport !== route.transport ||
        cap.protocol !== route.wireProtocol ||
        cap.providerIndex !== route.providerIndex ||
        cap.model !== route.model ||
        cap.maxPromptBytes > route.maxRequestBytes ||
        cap.maxResponseBytes > route.maxResponseBytes ||
        cap.maxOutputTokens > route.maxOutputTokens
      )
        fail();
    } else if (
      !gateway ||
      provider.authMode !== "codex_account_gateway" ||
      gateway.providerIndex !== cap.providerIndex ||
      cap.maxPromptBytes > gateway.limits.requestBytes ||
      cap.maxResponseBytes > gateway.limits.outputBytes ||
      cap.maxOutputTokens > gateway.limits.tokens
    )
      fail();
  }
  const prDescriptionCapability =
    "prDescriptionCapability" in parsed
      ? parseProducerPrDescriptionProfile(parsed.prDescriptionCapability)
      : undefined;
  if (canonicalJson(parsed) !== value) fail();
  return {
    ...(hosted ? { hosted } : {}),
    ...(modelDispatchCapability ? { modelDispatchCapability } : {}),
    ...(prDescriptionCapability === undefined
      ? {}
      : { prDescriptionCapability }),
    ...(lifecycleVerificationCapability
      ? { lifecycleVerificationCapability }
      : {}),
    ...(lifecycleVerificationUnavailableReason
      ? { lifecycleVerificationUnavailableReason }
      : {}),
    snapshotVersion: 3,
    configurationSource,
    configurationVersion,
    workspaceConfigurationVersion: Number(parsed.workspaceConfigurationVersion),
    repositoryConfigurationVersion:
      parsed.repositoryConfigurationVersion === null
        ? null
        : Number(parsed.repositoryConfigurationVersion),
    effectivePolicyDigest: String(parsed.effectivePolicyDigest),
    agent,
    agentProfileDigest: parsed.agentProfileDigest,
    producer: {
      producerReleaseId: String(producer.producerReleaseId),
      actionCommitSha: String(producer.actionCommitSha),
      runtimeCommitSha: String(producer.runtimeCommitSha),
    },
    configurationCanonicalJson,
    ...(contextToolsPlanCanonicalJson !== undefined
      ? { contextToolsPlanCanonicalJson: String(contextToolsPlanCanonicalJson) }
      : {}),
    deadline,
    gateway,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => key in value)
  );
}
function reference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)
  );
}
function revision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}
function fail(): never {
  throw new Error("review_run_runtime_snapshot_invalid");
}

/** Invalid enabled capability is rejected, never normalized or downgraded. */
export function parseLifecycleVerificationCapability(
  value: unknown,
): LifecycleVerificationCapability {
  if (record(value) && value.extensionId === "lifecycle-verification.v2")
    return parseLifecycleVerificationCapabilityV2(value);
  const names = [
    "extensionId",
    "descriptorDigest",
    "executor",
    "modelTransport",
    "providerIndex",
    "providerKind",
    "model",
    "maxDispatches",
    "maxPromptBytes",
    "maxResponseBytes",
    "maxOutputTokens",
    "deadlineMs",
    "attemptBudget",
  ];
  if (
    !record(value) ||
    !keys(value, names) ||
    value.extensionId !== lifecycleVerificationContract.extensionId ||
    value.descriptorDigest !== lifecycleVerificationDescriptorDigest ||
    value.executor !== lifecycleVerificationContract.executor ||
    value.modelTransport !== "account_gateway" ||
    !Number.isInteger(value.providerIndex) ||
    Number(value.providerIndex) < 0 ||
    Number(value.providerIndex) > 15 ||
    (value.providerKind !== "ocr" && value.providerKind !== "codex") ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 256 ||
    value.maxDispatches !== 2 ||
    value.attemptBudget !== 1
  )
    fail();
  const bounds = {
    maxPromptBytes: lifecycleVerificationContract.maxPromptBytes,
    maxResponseBytes: lifecycleVerificationContract.maxResponseBytes,
    maxOutputTokens: lifecycleVerificationContract.maxOutputTokens,
    deadlineMs: lifecycleVerificationContract.deadlineMs,
  };
  for (const [key, ceiling] of Object.entries(bounds)) {
    const n = value[key];
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n < 1 ||
      n > ceiling
    )
      fail();
  }
  if (
    Number(value.maxOutputTokens) <
    lifecycleVerificationContract.minOutputTokensPerTarget
  )
    fail();
  return Object.freeze({
    extensionId: lifecycleVerificationContract.extensionId,
    descriptorDigest: lifecycleVerificationDescriptorDigest,
    executor: lifecycleVerificationContract.executor,
    modelTransport: "account_gateway",
    providerIndex: Number(value.providerIndex),
    providerKind: value.providerKind,
    model: value.model,
    maxDispatches: 2,
    maxPromptBytes: Number(value.maxPromptBytes),
    maxResponseBytes: Number(value.maxResponseBytes),
    maxOutputTokens: Number(value.maxOutputTokens),
    deadlineMs: Number(value.deadlineMs),
    attemptBudget: 1,
  });
}
