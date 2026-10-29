import {
  lifecycleVerificationContract,
  parseReviewReviewerPlan,
  type ReviewReviewerPlanV1,
  type ReviewReviewerPlanReviewerV1,
  type ReviewReviewerModelSettings,
  lifecycleVerificationDescriptorDigest,
  type LifecycleVerificationCapabilityV1,
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
export type ReviewRunRuntimeSnapshotV3 = {
  readonly snapshotVersion: 3;
  readonly lifecycleVerificationUnavailableReason?:
    | "verification_configuration_invalid"
    | "verification_unavailable";
  readonly lifecycleVerificationCapability?: LifecycleVerificationCapabilityV1;
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
};

/** An explicit captured epoch is binding on both initial selection and recovery. */
export function reviewRunGatewayEpochMatches(
  snapshot: ReviewRunRuntimeSnapshot,
  selectedEpoch: number,
  allocationId?: string,
): boolean {
  const original =
    snapshot.snapshotVersion === 3
      ? snapshot.gateway
      : allocationId === undefined
        ? undefined
        : getReviewRunGatewayAllocation(snapshot, allocationId);
  return (
    original !== undefined &&
    (original?.expectedAuthorizationEpoch === undefined ||
      original.expectedAuthorizationEpoch === selectedEpoch)
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

export type ReviewRunGatewayAllocation = Omit<
  ReviewRunGatewaySelection,
  "providerIndex"
> &
  Readonly<{
    allocationId: string;
  }>;
export type ReviewRunReviewerV4 = Omit<
  ReviewReviewerPlanReviewerV1,
  "transport" | "unavailableReason"
> &
  Readonly<{
    transport: Readonly<{ kind: "account_gateway"; allocationId: string }>;
  }>;
export type ReviewRunRuntimeSnapshotV4 = Omit<
  ReviewRunRuntimeSnapshotV3,
  "snapshotVersion" | "agent" | "agentProfileDigest" | "gateway"
> &
  Readonly<{
    snapshotVersion: 4;
    primaryReviewerId: string;
    maxParallelReviewers: number;
    inlineMinAgreement: number;
    reviewers: readonly ReviewRunReviewerV4[];
    allocations: readonly ReviewRunGatewayAllocation[];
  }>;
export type ReviewRunRuntimeSnapshot =
  | ReviewRunRuntimeSnapshotV3
  | ReviewRunRuntimeSnapshotV4;

/** No selector can silently select a v4 sibling. */
export function getReviewRunReviewer(
  snapshot: ReviewRunRuntimeSnapshotV4,
  reviewerId: string,
): ReviewRunReviewerV4 {
  const reviewer = snapshot.reviewers.find(
    (row) => row.reviewerId === reviewerId,
  );
  if (!reviewer) fail();
  return reviewer;
}
export function getPrimaryReviewRunReviewer(
  snapshot: ReviewRunRuntimeSnapshotV4,
): ReviewRunReviewerV4 {
  return getReviewRunReviewer(snapshot, snapshot.primaryReviewerId);
}
export function getReviewRunGatewayAllocation(
  snapshot: ReviewRunRuntimeSnapshotV4,
  allocationId: string,
): ReviewRunGatewayAllocation {
  const allocation = snapshot.allocations.find(
    (row) => row.allocationId === allocationId,
  );
  if (!allocation) fail();
  return allocation;
}

export function buildReviewRunReviewerPlan(
  snapshot: ReviewRunRuntimeSnapshotV4,
  settingsMap: ReadonlyMap<
    string,
    ReviewReviewerModelSettings | undefined
  > = new Map(),
): ReviewReviewerPlanV1 {
  const reviewers = snapshot.reviewers.map((reviewer) => ({
    ...reviewer,
    transport: "account_gateway" as const,
    ...(settingsMap.get(reviewer.reviewerId) === undefined
      ? {}
      : { modelSettings: settingsMap.get(reviewer.reviewerId) }),
  }));
  return parseReviewReviewerPlan({
    planVersion: 1,
    primaryReviewerId: snapshot.primaryReviewerId,
    maxParallelReviewers: snapshot.maxParallelReviewers,
    inlineMinAgreement: snapshot.inlineMinAgreement,
    reviewers,
    concurrencyGroups: snapshot.allocations.map((allocation) => ({
      concurrencyGroupId: allocation.allocationId,
      maxParallel: Math.min(
        allocation.limits.concurrency,
        reviewers.filter(
          (row) => row.concurrencyGroupId === allocation.allocationId,
        ).length,
      ),
    })),
  });
}

export function parseReviewRunRuntimeSnapshot(
  value: string | null | undefined,
): ReviewRunRuntimeSnapshot | null {
  if (value === null || value === undefined) return null;
  if (new TextEncoder().encode(value).byteLength > 131_072) fail();
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed) || parsed.snapshotVersion !== 4)
    return parseReviewRunRuntimeSnapshotV3(value);
  if (
    !keys(parsed, [
      "snapshotVersion",
      "configurationSource",
      "configurationVersion",
      "workspaceConfigurationVersion",
      "repositoryConfigurationVersion",
      "effectivePolicyDigest",
      "producer",
      "configurationCanonicalJson",
      "deadline",
      "primaryReviewerId",
      "maxParallelReviewers",
      "inlineMinAgreement",
      "reviewers",
      "allocations",
      ...[
        "contextToolsPlanCanonicalJson",
        "lifecycleVerificationUnavailableReason",
        "lifecycleVerificationCapability",
        "prDescriptionCapability",
      ].filter((key) => Object.hasOwn(parsed, key)),
    ]) ||
    !Array.isArray(parsed.reviewers) ||
    parsed.reviewers.length < 1 ||
    parsed.reviewers.length > 16 ||
    !Array.isArray(parsed.allocations) ||
    parsed.allocations.length < 1 ||
    parsed.allocations.length > parsed.reviewers.length
  )
    fail();
  const {
    reviewers: rawReviewers,
    allocations: rawAllocations,
    primaryReviewerId,
    maxParallelReviewers,
    inlineMinAgreement,
    snapshotVersion: _version,
    ...common
  } = parsed;
  void _version;
  const allocations = rawAllocations.map((row: unknown) => {
    if (!record(row) || !reference(row.allocationId)) fail();
    return row;
  });
  if (
    new Set(allocations.map((row) => row.allocationId)).size !==
    allocations.length
  )
    fail();
  const reviewers = rawReviewers.map((row: unknown) => {
    if (
      !record(row) ||
      !record(row.transport) ||
      !keys(row.transport, ["kind", "allocationId"]) ||
      row.transport.kind !== "account_gateway" ||
      !reference(row.transport.allocationId) ||
      row.concurrencyGroupId !== row.transport.allocationId ||
      !allocations.some(
        (allocation) => allocation.allocationId === row.concurrencyGroupId,
      )
    )
      fail();
    return row;
  });
  if (reviewers.some((row) => Object.hasOwn(row, "unavailableReason"))) fail();
  const plan = parseReviewReviewerPlan({
    planVersion: 1,
    primaryReviewerId,
    maxParallelReviewers,
    inlineMinAgreement,
    reviewers: reviewers.map((row) => ({
      ...row,
      transport: "account_gateway",
    })),
    concurrencyGroups: allocations.map((allocation) => {
      const limits = parseReviewRunGatewayLimits(allocation.limits);
      return {
        concurrencyGroupId: allocation.allocationId,
        maxParallel: Math.min(
          limits.concurrency,
          reviewers.filter(
            (row) => row.concurrencyGroupId === allocation.allocationId,
          ).length,
        ),
      };
    }),
  });
  const primary = plan.reviewers[0]!;
  let parsedCommon: ReviewRunRuntimeSnapshotV3 | undefined;
  const selectedAllocations = allocations.map((row) => {
    const { allocationId, ...selection } = row;
    const reviewer = plan.reviewers.find(
      (reviewer) => reviewer.concurrencyGroupId === allocationId,
    );
    if (!reviewer) fail();
    const primaryAllocation = primary.concurrencyGroupId === allocationId;
    const { lifecycleVerificationCapability: _capability, ...otherCommon } =
      common;
    void _capability;
    // Common snapshot facts and every exact allowance retain the historical validators.
    const legacy = parseReviewRunRuntimeSnapshotV3(
      canonicalJson({
        ...(primaryAllocation ? common : otherCommon),
        snapshotVersion: 3,
        agent: reviewer.agentProfile,
        agentProfileDigest: reviewer.agentProfileDigest,
        gateway: { ...selection, providerIndex: reviewer.providerIndex },
      }),
      131_072,
    );
    if (!legacy?.gateway) fail();
    if (primaryAllocation) parsedCommon = legacy;
    return {
      allocationId: String(allocationId),
      ...selection,
      limits: legacy.gateway.limits,
    } as ReviewRunGatewayAllocation;
  });
  if (!parsedCommon || canonicalJson(parsed) !== value) fail();
  const configuration: unknown = JSON.parse(
    parsedCommon.configurationCanonicalJson,
  );
  if (
    !record(configuration) ||
    !Array.isArray(configuration.providers) ||
    configuration.providers.length !== plan.reviewers.length
  )
    fail();
  for (const reviewer of plan.reviewers) {
    const provider: unknown = configuration.providers[reviewer.providerIndex];
    const allocation = selectedAllocations.find(
      (row) => row.allocationId === reviewer.concurrencyGroupId,
    )!;
    if (
      !record(provider) ||
      provider.authMode !== "codex_account_gateway" ||
      provider.gatewayBindingId !== allocation.bindingId ||
      provider.gatewayProfileRef !== allocation.profileRef ||
      provider.model !== reviewer.requestedModel ||
      provider.reasoningEffort !== reviewer.reasoningEffort ||
      provider.agenticContext !== reviewer.agenticContext ||
      provider.fastMode !== reviewer.fastMode
    )
      fail();
  }
  const {
    agent: _agent,
    agentProfileDigest: _digest,
    gateway: _gateway,
    snapshotVersion: _legacyVersion,
    ...shared
  } = parsedCommon;
  void _agent;
  void _digest;
  void _gateway;
  void _legacyVersion;
  return {
    ...shared,
    snapshotVersion: 4,
    primaryReviewerId: plan.primaryReviewerId,
    maxParallelReviewers: plan.maxParallelReviewers,
    inlineMinAgreement: plan.inlineMinAgreement,
    reviewers: plan.reviewers.map((reviewer) => ({
      ...reviewer,
      transport: {
        kind: "account_gateway",
        allocationId: reviewer.concurrencyGroupId,
      },
    })),
    allocations: selectedAllocations,
  };
}

function parseReviewRunRuntimeSnapshotV3(
  value: string | null | undefined,
  maximumBytes = 32_768,
): ReviewRunRuntimeSnapshotV3 | null {
  if (value === null || value === undefined) return null;
  if (new TextEncoder().encode(value).byteLength > maximumBytes) fail();
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
      ...("lifecycleVerificationUnavailableReason" in parsed
        ? ["lifecycleVerificationUnavailableReason"]
        : []),
      ...("lifecycleVerificationCapability" in parsed
        ? ["lifecycleVerificationCapability"]
        : []),
      ...("prDescriptionCapability" in parsed
        ? ["prDescriptionCapability"]
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
      !gateway ||
      !record(provider) ||
      provider.authMode !== "codex_account_gateway" ||
      gateway.providerIndex !== cap.providerIndex ||
      provider.model !== cap.model ||
      cap.providerKind !== reviewAgentExecutionProviderKind(agent) ||
      !["ocr", "codex"].includes(agent.agentKind) ||
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
): LifecycleVerificationCapabilityV1 {
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
    typeof value.providerKind !== "string" ||
    !["ocr", "codex"].includes(value.providerKind) ||
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
  return Object.freeze({ ...value }) as LifecycleVerificationCapabilityV1;
}
