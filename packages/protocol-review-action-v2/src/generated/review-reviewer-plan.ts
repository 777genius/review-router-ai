// Generated from shared/src/review-reviewer-plan.ts. Do not edit.
import {
  parseReviewAgentProfiles,
  type ReviewAgentProfile,
} from "./review-agent-profile.js";

/** Safe scheduling facts. This descriptor never grants execution authority. */
export const reviewerPlanContract = Object.freeze({
  planVersion: 1,
  maxReviewers: 16,
  maxPlanBytes: 65_536,
  runtimeEnvKey: "REVIEW_ROUTER_REVIEWER_PLAN_JSON",
  reviewerIdHeader: "x-reviewrouter-reviewer-id",
  transport: "account_gateway",
  investigationDescriptorVersion: 3,
  reviewerAvailability: 1,
} as const);

export const reviewerPlanDescriptorDigest =
  "sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6";

export type ReviewReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type ReviewReviewerModelSettings = Readonly<{
  model: string;
  reasoning: null | Readonly<{
    allowed: readonly ReviewReasoningEffort[];
    default: ReviewReasoningEffort;
  }>;
}>;

/** The historical v3 descriptor is carried unchanged inside an exact grant. */
export type ReviewReviewerInvestigationDescriptorV3 = Readonly<{
  authorizationDescriptorVersion: 3;
  capability: "review_investigation_v1";
  coverageProfileHash: string;
  extensionCanonicalizerDigest: string;
  extensionId: "review-investigation-shadow.v1";
  extensionSchemaDigest: string;
  policyHash: string;
  providerCapabilities: readonly Readonly<{
    providerKind: "codex" | "claude_code";
    capabilities: readonly ReviewReviewerInvestigationCapability[];
  }>[];
}>;
export type ReviewReviewerInvestigationCapability =
  | "context_critic"
  | "cross_revision_replay"
  | "production_effects"
  | "recording"
  | "shadow"
  | "verified_clean";
export type ReviewReviewerInvestigationGrant = Readonly<{
  reviewerId: string;
  providerVoteIdentityHash: string;
  requestedModel: string;
  agentProfileDigest: string;
  descriptor: ReviewReviewerInvestigationDescriptorV3;
}>;

export type ReviewReviewerPlanReviewerV1 = Readonly<{
  reviewerId: string;
  providerIndex: number;
  providerVoteIdentityHash: string;
  required: boolean;
  unavailableReason?: "allocation_unavailable" | "model_settings_unavailable";
  transport: "account_gateway";
  requestedModel: string;
  reasoningEffort?: ReviewReasoningEffort;
  agenticContext: boolean;
  fastMode: boolean;
  modelSettings?: ReviewReviewerModelSettings;
  agentProfile: ReviewAgentProfile;
  agentProfileDigest: string;
  concurrencyGroupId: string;
  investigationGrant: ReviewReviewerInvestigationGrant | null;
}>;
export type ReviewReviewerPlanV1 = Readonly<{
  planVersion: 1;
  primaryReviewerId: string;
  maxParallelReviewers: number;
  inlineMinAgreement: number;
  reviewers: readonly ReviewReviewerPlanReviewerV1[];
  concurrencyGroups: readonly Readonly<{
    concurrencyGroupId: string;
    maxParallel: number;
  }>[];
}>;

/** Undefined is handled by the legacy-only caller; every supplied selector is exact. */
export function parseReviewReviewerId(value: unknown): string {
  if (!reference(value)) fail();
  return value;
}

const efforts: readonly ReviewReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
const dependencies: Readonly<
  Record<
    ReviewReviewerInvestigationCapability,
    readonly ReviewReviewerInvestigationCapability[]
  >
> = {
  context_critic: ["shadow"],
  cross_revision_replay: ["shadow"],
  production_effects: ["context_critic", "shadow"],
  recording: [],
  shadow: ["recording"],
  verified_clean: ["context_critic", "production_effects"],
};

/** One parser is exported to the Action by the canonical protocol generator. */
export function parseReviewReviewerPlan(value: unknown): ReviewReviewerPlanV1 {
  if (typeof value === "string") {
    if (bytes(value) > reviewerPlanContract.maxPlanBytes) fail();
    value = JSON.parse(value);
  }
  if (
    !record(value) ||
    bytes(JSON.stringify(value)) > reviewerPlanContract.maxPlanBytes ||
    !keys(value, [
      "planVersion",
      "primaryReviewerId",
      "maxParallelReviewers",
      "inlineMinAgreement",
      "reviewers",
      "concurrencyGroups",
    ]) ||
    value.planVersion !== 1 ||
    !Array.isArray(value.reviewers) ||
    value.reviewers.length < 1 ||
    value.reviewers.length > 16 ||
    !integer(value.maxParallelReviewers, 1, value.reviewers.length) ||
    !integer(value.inlineMinAgreement, 1, value.reviewers.length) ||
    !Array.isArray(value.concurrencyGroups) ||
    value.concurrencyGroups.length < 1 ||
    value.concurrencyGroups.length > value.reviewers.length
  )
    fail();
  const reviewers = value.reviewers.map(parseReviewer);
  if (
    value.primaryReviewerId !== reviewers[0]!.reviewerId ||
    !unique(reviewers.map((row) => row.reviewerId)) ||
    !unique(reviewers.map((row) => row.providerVoteIdentityHash)) ||
    !unique(reviewers.map((row) => row.providerIndex)) ||
    reviewers.some(
      (row, index) =>
        index > 0 && row.providerIndex <= reviewers[index - 1]!.providerIndex,
    )
  )
    fail();
  const groups = value.concurrencyGroups.map((candidate: unknown) => {
    if (
      !record(candidate) ||
      !keys(candidate, ["concurrencyGroupId", "maxParallel"]) ||
      !reference(candidate.concurrencyGroupId)
    )
      fail();
    const count = reviewers.filter(
      (row) => row.concurrencyGroupId === candidate.concurrencyGroupId,
    ).length;
    if (!integer(candidate.maxParallel, 1, count)) fail();
    return Object.freeze({
      concurrencyGroupId: candidate.concurrencyGroupId,
      maxParallel: candidate.maxParallel,
    });
  });
  if (
    !unique(groups.map((row) => row.concurrencyGroupId)) ||
    reviewers.some(
      (row) =>
        !groups.some(
          (group) => group.concurrencyGroupId === row.concurrencyGroupId,
        ),
    )
  )
    fail();
  return Object.freeze({
    planVersion: 1,
    primaryReviewerId: String(value.primaryReviewerId),
    maxParallelReviewers: value.maxParallelReviewers,
    inlineMinAgreement: value.inlineMinAgreement,
    reviewers: Object.freeze(reviewers),
    concurrencyGroups: Object.freeze(groups),
  });
}

function parseReviewer(value: unknown): ReviewReviewerPlanReviewerV1 {
  if (
    !record(value) ||
    !keys(value, [
      "reviewerId",
      "providerIndex",
      "providerVoteIdentityHash",
      "required",
      "transport",
      "requestedModel",
      "agenticContext",
      "fastMode",
      "agentProfile",
      "agentProfileDigest",
      "concurrencyGroupId",
      "investigationGrant",
      ...(Object.hasOwn(value, "reasoningEffort") ? ["reasoningEffort"] : []),
      ...(Object.hasOwn(value, "modelSettings") ? ["modelSettings"] : []),
      ...(Object.hasOwn(value, "unavailableReason")
        ? ["unavailableReason"]
        : []),
    ]) ||
    !reference(value.reviewerId) ||
    !integer(value.providerIndex, 0, 15) ||
    !digest(value.providerVoteIdentityHash) ||
    typeof value.required !== "boolean" ||
    value.transport !== "account_gateway" ||
    !model(value.requestedModel) ||
    typeof value.agenticContext !== "boolean" ||
    typeof value.fastMode !== "boolean" ||
    !digest(value.agentProfileDigest) ||
    !reference(value.concurrencyGroupId) ||
    (Object.hasOwn(value, "reasoningEffort") && !effort(value.reasoningEffort))
  )
    fail();
  if (
    Object.hasOwn(value, "unavailableReason") &&
    value.unavailableReason !== "allocation_unavailable" &&
    value.unavailableReason !== "model_settings_unavailable"
  )
    fail();
  const agentProfile = parseReviewAgentProfiles([value.agentProfile])[0]!;
  if (
    !agentProfile.modelTransports.includes("account_gateway") ||
    (agentProfile.agentKind === "ocr" && !value.agenticContext)
  )
    fail();
  const modelSettings = Object.hasOwn(value, "modelSettings")
    ? parseReviewReviewerModelSettings(
        value.modelSettings,
        value.requestedModel,
      )
    : undefined;
  const investigationGrant =
    value.investigationGrant === null
      ? null
      : parseReviewReviewerInvestigationGrant(value.investigationGrant, {
          reviewerId: value.reviewerId,
          providerVoteIdentityHash: value.providerVoteIdentityHash,
          requestedModel: value.requestedModel,
          agentProfileDigest: value.agentProfileDigest,
          agentKind: agentProfile.agentKind,
          agenticContext: value.agenticContext,
        });
  return Object.freeze({
    reviewerId: value.reviewerId,
    ...(value.unavailableReason === undefined
      ? {}
      : {
          unavailableReason: value.unavailableReason as
            | "allocation_unavailable"
            | "model_settings_unavailable",
        }),
    providerIndex: value.providerIndex,
    providerVoteIdentityHash: value.providerVoteIdentityHash,
    required: value.required,
    transport: "account_gateway",
    requestedModel: value.requestedModel,
    ...(effort(value.reasoningEffort)
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
    agenticContext: value.agenticContext,
    fastMode: value.fastMode,
    ...(modelSettings ? { modelSettings } : {}),
    agentProfile,
    agentProfileDigest: value.agentProfileDigest,
    concurrencyGroupId: value.concurrencyGroupId,
    investigationGrant,
  });
}

export function parseReviewReviewerModelSettings(
  value: unknown,
  requestedModel: string,
): ReviewReviewerModelSettings {
  if (
    !record(value) ||
    !keys(value, ["model", "reasoning"]) ||
    value.model !== requestedModel ||
    bytes(JSON.stringify(value)) > 2048
  )
    fail();
  if (value.reasoning === null)
    return Object.freeze({ model: requestedModel, reasoning: null });
  const reasoning = value.reasoning;
  if (
    !record(reasoning) ||
    !keys(reasoning, ["allowed", "default"]) ||
    !Array.isArray(reasoning.allowed) ||
    reasoning.allowed.length < 1 ||
    reasoning.allowed.length > efforts.length ||
    reasoning.allowed.some((value) => !effort(value)) ||
    !unique(reasoning.allowed) ||
    !effort(reasoning.default) ||
    !reasoning.allowed.includes(reasoning.default)
  )
    fail();
  const allowed = reasoning.allowed as ReviewReasoningEffort[];
  if (
    allowed.some(
      (value, index) =>
        index > 0 &&
        efforts.indexOf(value) <= efforts.indexOf(allowed[index - 1]!),
    )
  )
    fail();
  return Object.freeze({
    model: requestedModel,
    reasoning: Object.freeze({
      allowed: Object.freeze([...allowed]),
      default: reasoning.default,
    }),
  });
}

export function parseReviewReviewerInvestigationGrant(
  value: unknown,
  reviewer: Readonly<{
    reviewerId: string;
    providerVoteIdentityHash: string;
    requestedModel: string;
    agentProfileDigest: string;
    agentKind: ReviewAgentProfile["agentKind"];
    agenticContext: boolean;
  }>,
): ReviewReviewerInvestigationGrant {
  if (
    !record(value) ||
    !keys(value, [
      "reviewerId",
      "providerVoteIdentityHash",
      "requestedModel",
      "agentProfileDigest",
      "descriptor",
    ]) ||
    value.reviewerId !== reviewer.reviewerId ||
    value.providerVoteIdentityHash !== reviewer.providerVoteIdentityHash ||
    value.requestedModel !== reviewer.requestedModel ||
    value.agentProfileDigest !== reviewer.agentProfileDigest ||
    reviewer.agentKind === "ocr" ||
    !reviewer.agenticContext
  )
    fail();
  const descriptor = parseReviewReviewerInvestigationDescriptorV3(
    value.descriptor,
  );
  const providerKind =
    reviewer.agentKind === "claude" ? "claude_code" : "codex";
  if (
    descriptor.providerCapabilities.length !== 1 ||
    descriptor.providerCapabilities[0]!.providerKind !== providerKind
  )
    fail();
  return Object.freeze({
    reviewerId: reviewer.reviewerId,
    providerVoteIdentityHash: reviewer.providerVoteIdentityHash,
    requestedModel: reviewer.requestedModel,
    agentProfileDigest: reviewer.agentProfileDigest,
    descriptor,
  });
}

export function parseReviewReviewerInvestigationDescriptorV3(
  value: unknown,
): ReviewReviewerInvestigationDescriptorV3 {
  if (
    !record(value) ||
    !keys(value, [
      "authorizationDescriptorVersion",
      "capability",
      "coverageProfileHash",
      "extensionCanonicalizerDigest",
      "extensionId",
      "extensionSchemaDigest",
      "policyHash",
      "providerCapabilities",
    ]) ||
    value.authorizationDescriptorVersion !== 3 ||
    value.capability !== "review_investigation_v1" ||
    value.extensionId !== "review-investigation-shadow.v1" ||
    !digest(value.coverageProfileHash) ||
    !digest(value.extensionCanonicalizerDigest) ||
    !digest(value.extensionSchemaDigest) ||
    !digest(value.policyHash) ||
    !Array.isArray(value.providerCapabilities) ||
    value.providerCapabilities.length < 1 ||
    value.providerCapabilities.length > 2
  )
    fail();
  const providerCapabilities = value.providerCapabilities.map(
    (row: unknown) => {
      if (
        !record(row) ||
        !keys(row, ["providerKind", "capabilities"]) ||
        (row.providerKind !== "codex" && row.providerKind !== "claude_code") ||
        !Array.isArray(row.capabilities) ||
        row.capabilities.length < 1 ||
        row.capabilities.length > 6 ||
        row.capabilities.some(
          (capability) =>
            typeof capability !== "string" ||
            !Object.hasOwn(dependencies, capability),
        ) ||
        !unique(row.capabilities) ||
        !row.capabilities.includes("recording")
      )
        fail();
      const capabilities =
        row.capabilities as ReviewReviewerInvestigationCapability[];
      if (
        capabilities.some(
          (capability, index) =>
            index > 0 && capability <= capabilities[index - 1]!,
        )
      )
        fail();
      if (
        capabilities.some((capability) =>
          dependencies[capability].some(
            (dependency) => !capabilities.includes(dependency),
          ),
        )
      )
        fail();
      return Object.freeze({
        providerKind: row.providerKind,
        capabilities: Object.freeze([...capabilities]),
      });
    },
  );
  if (
    !unique(providerCapabilities.map((row) => row.providerKind)) ||
    providerCapabilities.some(
      (row, index) =>
        index > 0 &&
        row.providerKind <= providerCapabilities[index - 1]!.providerKind,
    )
  )
    fail();
  return Object.freeze({
    authorizationDescriptorVersion: 3,
    capability: "review_investigation_v1",
    coverageProfileHash: value.coverageProfileHash,
    extensionCanonicalizerDigest: value.extensionCanonicalizerDigest,
    extensionId: "review-investigation-shadow.v1",
    extensionSchemaDigest: value.extensionSchemaDigest,
    policyHash: value.policyHash,
    providerCapabilities: Object.freeze(providerCapabilities),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function reference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)
  );
}
function model(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  );
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
function effort(value: unknown): value is ReviewReasoningEffort {
  return (
    typeof value === "string" &&
    efforts.includes(value as ReviewReasoningEffort)
  );
}
function unique(values: readonly unknown[]) {
  return new Set(values).size === values.length;
}
function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
function fail(): never {
  throw new Error("review_reviewer_plan_invalid");
}
