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

/** Private admission data. Never included in public authorization claims/facts. */
export type ReviewRunRuntimeSnapshot = {
  readonly snapshotVersion: 3;
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
  readonly deadline: string;
  readonly gateway: ReviewRunGatewaySelection | null;
};

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
  if (canonicalJson(parsed) !== value) fail();
  return {
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
