import {
  parseReviewModelDispatchProfileV2,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import {
  ProducerDistributionKind,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  assertCommitSha,
  assertDate,
  assertIdentifier,
  assertPositiveInteger,
  assertSha256,
  canonicalJson,
  cloneDate,
  invalid,
} from "./review-run-control-types";
import {
  parseReviewAgentProfiles,
  type ReviewAgentProfile,
} from "./review-agent-profile";

export const prDescriptionExtensionIdV1 = "pr-description.v1";

export type ProducerPrDescriptionProfile = Readonly<{
  readonly extensionId: typeof prDescriptionExtensionIdV1;
  readonly canonicalizerDigest: string;
}>;

/** Approved extension identity, detached from caller-owned objects. */
export function parseProducerPrDescriptionProfile(
  value: unknown,
): ProducerPrDescriptionProfile {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "extensionId") ||
    !Object.hasOwn(value, "canonicalizerDigest") ||
    !("extensionId" in value) ||
    !("canonicalizerDigest" in value) ||
    value.extensionId !== prDescriptionExtensionIdV1 ||
    typeof value.canonicalizerDigest !== "string"
  ) {
    invalid("pr_description_profile_invalid");
  }
  assertSha256(
    value.canonicalizerDigest,
    "pr_description_canonicalizer_digest",
  );
  return Object.freeze({
    extensionId: prDescriptionExtensionIdV1,
    canonicalizerDigest: value.canonicalizerDigest,
  });
}

export const lifecycleVerificationExtensionIdV1 = "lifecycle-verification.v1";

export type ProducerLifecycleVerificationProfile = Readonly<{
  extensionId: typeof lifecycleVerificationExtensionIdV1;
  descriptorDigest: string;
}>;

/** Exact immutable extension identity; absence keeps legacy approval bytes. */
export function parseProducerLifecycleVerificationProfile(
  value: unknown,
): ProducerLifecycleVerificationProfile {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "descriptorDigest,extensionId"
  )
    invalid("producer_lifecycle_verification_profile_invalid");
  const profile = value as Record<string, unknown>;
  if (
    profile.extensionId !== lifecycleVerificationExtensionIdV1 ||
    typeof profile.descriptorDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(profile.descriptorDigest)
  )
    invalid("producer_lifecycle_verification_profile_invalid");
  return Object.freeze({
    extensionId: lifecycleVerificationExtensionIdV1,
    descriptorDigest: profile.descriptorDigest,
  });
}

export const reviewInvestigationCapabilityV1 = "review_investigation_v1";

export type ProducerContextToolsProfile = Readonly<{
  extensionId: "context-tools.v1";
  descriptorDigest: string;
}>;

export function parseProducerContextToolsProfile(
  value: unknown,
): ProducerContextToolsProfile {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "descriptorDigest,extensionId"
  )
    invalid("producer_context_tools_profile_invalid");
  const profile = value as Record<string, unknown>;
  if (
    profile.extensionId !== "context-tools.v1" ||
    typeof profile.descriptorDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(profile.descriptorDigest)
  )
    invalid("producer_context_tools_profile_invalid");
  return Object.freeze({
    extensionId: "context-tools.v1",
    descriptorDigest: profile.descriptorDigest,
  });
}

export type ProducerReviewInvestigationProfile = Readonly<{
  readonly capability: typeof reviewInvestigationCapabilityV1;
  readonly coverageProfileHash: string;
  readonly policyHash: string;
}>;

export type ReviewProtocolLimits = {
  readonly maxWorkSlots: number;
  readonly maxAttemptsPerSlot: number;
  readonly maxObservationBytes: number;
  readonly maxObservationFindings: number;
  readonly maxProjectionBytes: number;
  readonly maxProjectionFindings: number;
  readonly maxPublicationOperations: number;
  readonly maxPublicationChunks: number;
  readonly maxPublicationBodyBytes: number;
  readonly maxRequestBatchSize: number;
  readonly maxLeaseDurationMs: number;
  readonly maxResultReportDurationMs: number;
  readonly maxReconciliationDurationMs: number;
};

export type ReviewProtocolLimitsV2 = ReviewProtocolLimits & {
  readonly protocolLimitsProfileId: string;
  readonly limitsDigest: string;
  readonly registeredAt: Date;
};

export type ReviewOperationalSloThresholds = {
  readonly integrationEventDeliveryMs: number;
  readonly outboxClaimAgeMs: number;
  readonly missingCompletionProcessMs: number;
  readonly dueCompletionProcessMs: number;
  readonly publicationReconciliationMs: number;
  readonly v1DrainMs: number;
  readonly admissionMs: number;
  readonly pruningBacklogAgeMs: number;
};

export type ReviewOperationalSloProfileV2 = ReviewOperationalSloThresholds & {
  readonly operationalSloProfileId: string;
  readonly sloDigest: string;
  readonly ownerRefs: readonly string[];
  readonly runbookRefs: readonly string[];
  readonly registeredAt: Date;
};

export type ProducerRelease = {
  readonly contextToolsProfile?: ProducerContextToolsProfile;
  readonly producerReleaseId: string;
  readonly distributionKind: ProducerDistributionKind;
  readonly actionCommitSha: string;
  readonly runtimeCommitSha: string;
  readonly wrapperEntrypointDigest: string | null;
  readonly runtimeEntrypointDigest: string;
  readonly contextGatewayPolicyVersion: string | null;
  readonly contextGatewayEntrypointDigest: string | null;
  readonly reviewInvestigationProfile: ProducerReviewInvestigationProfile | null;
  readonly agentProfiles: readonly ReviewAgentProfile[] | null;
  readonly prDescriptionProfile?: ProducerPrDescriptionProfile | null;
  readonly lifecycleVerificationProfile?: ProducerLifecycleVerificationProfile | null;
  readonly modelDispatchProfile?: ReviewModelDispatchProfileV2 | null;
  readonly schemaDigest: string;
  readonly capabilityProfile: ReviewCapabilityProfile;
  readonly protocolLimitsProfileId: string;
  readonly operationalSloProfileId: string;
  readonly state: ProducerReleaseState;
  readonly registeredAt: Date;
  readonly revokedAt: Date | null;
};

export type ProducerReleaseCandidate = Omit<
  ProducerRelease,
  | "state"
  | "registeredAt"
  | "revokedAt"
  | "contextGatewayPolicyVersion"
  | "contextGatewayEntrypointDigest"
  | "reviewInvestigationProfile"
  | "agentProfiles"
> & {
  readonly contextGatewayPolicyVersion?: string | null;
  readonly contextGatewayEntrypointDigest?: string | null;
  readonly reviewInvestigationProfile?: ProducerReviewInvestigationProfile | null;
  readonly agentProfiles?: readonly ReviewAgentProfile[] | null;
};

export function createReviewProtocolLimitsProfile(input: {
  readonly protocolLimitsProfileId: string;
  readonly limitsDigest: string;
  readonly limits: ReviewProtocolLimits;
  readonly absoluteMaxima: ReviewProtocolLimits;
  readonly registeredAt: Date;
}): ReviewProtocolLimitsV2 {
  assertIdentifier(input.protocolLimitsProfileId, "protocol_limits_profile_id");
  assertSha256(input.limitsDigest, "limits_digest");
  assertDate(input.registeredAt, "registered_at");
  for (const key of Object.keys(
    input.limits,
  ) as (keyof ReviewProtocolLimits)[]) {
    assertPositiveInteger(input.limits[key], key);
    assertPositiveInteger(input.absoluteMaxima[key], `absolute_${key}`);
    if (input.limits[key] > input.absoluteMaxima[key]) {
      invalid(`protocol_limit_exceeds_absolute_maximum:${key}`);
    }
  }
  return {
    protocolLimitsProfileId: input.protocolLimitsProfileId,
    limitsDigest: input.limitsDigest,
    ...input.limits,
    registeredAt: cloneDate(input.registeredAt),
  };
}

export function canonicalReviewProtocolLimits(
  limits: ReviewProtocolLimits,
): string {
  return canonicalJson({
    maxWorkSlots: limits.maxWorkSlots,
    maxAttemptsPerSlot: limits.maxAttemptsPerSlot,
    maxObservationBytes: limits.maxObservationBytes,
    maxObservationFindings: limits.maxObservationFindings,
    maxProjectionBytes: limits.maxProjectionBytes,
    maxProjectionFindings: limits.maxProjectionFindings,
    maxPublicationOperations: limits.maxPublicationOperations,
    maxPublicationChunks: limits.maxPublicationChunks,
    maxPublicationBodyBytes: limits.maxPublicationBodyBytes,
    maxRequestBatchSize: limits.maxRequestBatchSize,
    maxLeaseDurationMs: limits.maxLeaseDurationMs,
    maxResultReportDurationMs: limits.maxResultReportDurationMs,
    maxReconciliationDurationMs: limits.maxReconciliationDurationMs,
  });
}

export function createReviewOperationalSloProfile(input: {
  readonly operationalSloProfileId: string;
  readonly sloDigest: string;
  readonly thresholds: ReviewOperationalSloThresholds;
  readonly ownerRefs: readonly string[];
  readonly runbookRefs: readonly string[];
  readonly registeredAt: Date;
}): ReviewOperationalSloProfileV2 {
  assertIdentifier(input.operationalSloProfileId, "operational_slo_profile_id");
  assertSha256(input.sloDigest, "slo_digest");
  assertDate(input.registeredAt, "registered_at");
  for (const [key, value] of Object.entries(input.thresholds)) {
    assertPositiveInteger(value, key);
  }
  assertBoundedReferences(input.ownerRefs, "owner_refs");
  assertBoundedReferences(input.runbookRefs, "runbook_refs");
  if (input.ownerRefs.length === 0 || input.runbookRefs.length === 0) {
    invalid("operational_slo_ownership_required");
  }
  return {
    operationalSloProfileId: input.operationalSloProfileId,
    sloDigest: input.sloDigest,
    ...input.thresholds,
    ownerRefs: [...new Set(input.ownerRefs)].sort(),
    runbookRefs: [...new Set(input.runbookRefs)].sort(),
    registeredAt: cloneDate(input.registeredAt),
  };
}

export function canonicalReviewOperationalSloProfile(input: {
  readonly thresholds: ReviewOperationalSloThresholds;
  readonly ownerRefs: readonly string[];
  readonly runbookRefs: readonly string[];
}): string {
  return canonicalJson({
    integrationEventDeliveryMs: input.thresholds.integrationEventDeliveryMs,
    outboxClaimAgeMs: input.thresholds.outboxClaimAgeMs,
    missingCompletionProcessMs: input.thresholds.missingCompletionProcessMs,
    dueCompletionProcessMs: input.thresholds.dueCompletionProcessMs,
    publicationReconciliationMs: input.thresholds.publicationReconciliationMs,
    v1DrainMs: input.thresholds.v1DrainMs,
    admissionMs: input.thresholds.admissionMs,
    pruningBacklogAgeMs: input.thresholds.pruningBacklogAgeMs,
    ownerRefs: [...new Set(input.ownerRefs)].sort(),
    runbookRefs: [...new Set(input.runbookRefs)].sort(),
  });
}

export function createProducerRelease(
  candidate: ProducerReleaseCandidate,
  registeredAt: Date,
): ProducerRelease {
  assertIdentifier(candidate.producerReleaseId, "producer_release_id");
  assertCommitSha(candidate.actionCommitSha, "action_commit_sha");
  assertCommitSha(candidate.runtimeCommitSha, "runtime_commit_sha");
  assertSha256(candidate.runtimeEntrypointDigest, "runtime_entrypoint_digest");
  assertSha256(candidate.schemaDigest, "schema_digest");
  assertIdentifier(
    candidate.protocolLimitsProfileId,
    "protocol_limits_profile_id",
  );
  assertIdentifier(
    candidate.operationalSloProfileId,
    "operational_slo_profile_id",
  );
  assertDate(registeredAt, "registered_at");
  if (candidate.wrapperEntrypointDigest !== null) {
    assertSha256(
      candidate.wrapperEntrypointDigest,
      "wrapper_entrypoint_digest",
    );
  }
  const contextGatewayPolicyVersion =
    candidate.contextGatewayPolicyVersion ?? null;
  const contextGatewayEntrypointDigest =
    candidate.contextGatewayEntrypointDigest ?? null;
  const reviewInvestigationProfile =
    candidate.reviewInvestigationProfile ?? null;
  if (
    (contextGatewayPolicyVersion === null) !==
    (contextGatewayEntrypointDigest === null)
  ) {
    invalid("context_gateway_release_artifact_incomplete");
  }
  if (reviewInvestigationProfile !== null) {
    if (
      reviewInvestigationProfile.capability !== reviewInvestigationCapabilityV1
    ) {
      invalid("review_investigation_capability_invalid");
    }
    assertSha256(
      reviewInvestigationProfile.coverageProfileHash,
      "review_investigation_coverage_profile_hash",
    );
    assertSha256(
      reviewInvestigationProfile.policyHash,
      "review_investigation_policy_hash",
    );
    if (
      contextGatewayPolicyVersion === null ||
      contextGatewayEntrypointDigest === null
    ) {
      invalid("review_investigation_context_gateway_artifact_required");
    }
  }
  if (
    contextGatewayPolicyVersion !== null &&
    contextGatewayEntrypointDigest !== null
  ) {
    assertIdentifier(
      contextGatewayPolicyVersion,
      "context_gateway_policy_version",
    );
    assertSha256(
      contextGatewayEntrypointDigest,
      "context_gateway_entrypoint_digest",
    );
  }
  if (
    candidate.distributionKind === ProducerDistributionKind.HostedComposite &&
    candidate.wrapperEntrypointDigest === null
  ) {
    invalid("hosted_composite_wrapper_digest_required");
  }
  return {
    ...(candidate.modelDispatchProfile == null
      ? {}
      : {
          modelDispatchProfile: parseReviewModelDispatchProfileV2(
            candidate.modelDispatchProfile,
          ),
        }),
    ...(candidate.prDescriptionProfile == null
      ? {}
      : {
          prDescriptionProfile: parseProducerPrDescriptionProfile(
            candidate.prDescriptionProfile,
          ),
        }),
    ...(candidate.lifecycleVerificationProfile == null
      ? {}
      : {
          lifecycleVerificationProfile:
            parseProducerLifecycleVerificationProfile(
              candidate.lifecycleVerificationProfile,
            ),
        }),
    producerReleaseId: candidate.producerReleaseId,
    distributionKind: candidate.distributionKind,
    actionCommitSha: candidate.actionCommitSha,
    runtimeCommitSha: candidate.runtimeCommitSha,
    wrapperEntrypointDigest: candidate.wrapperEntrypointDigest,
    runtimeEntrypointDigest: candidate.runtimeEntrypointDigest,
    contextGatewayPolicyVersion,
    contextGatewayEntrypointDigest,
    reviewInvestigationProfile,
    agentProfiles:
      candidate.agentProfiles == null
        ? null
        : parseReviewAgentProfiles(candidate.agentProfiles),
    ...(candidate.contextToolsProfile !== undefined
      ? {
          contextToolsProfile: parseProducerContextToolsProfile(
            candidate.contextToolsProfile,
          ),
        }
      : {}),
    schemaDigest: candidate.schemaDigest,
    capabilityProfile: candidate.capabilityProfile,
    protocolLimitsProfileId: candidate.protocolLimitsProfileId,
    operationalSloProfileId: candidate.operationalSloProfileId,
    state: ProducerReleaseState.Registered,
    registeredAt: cloneDate(registeredAt),
    revokedAt: null,
  };
}

export function revokeProducerRelease(
  release: ProducerRelease,
  revokedAt: Date,
): ProducerRelease {
  assertDate(revokedAt, "revoked_at");
  if (release.state === ProducerReleaseState.Revoked) {
    return cloneProducerRelease(release);
  }
  if (revokedAt < release.registeredAt) {
    invalid("revoked_before_registered");
  }
  return {
    ...release,
    state: ProducerReleaseState.Revoked,
    registeredAt: cloneDate(release.registeredAt),
    revokedAt: cloneDate(revokedAt),
  };
}

export function producerReleaseImmutableKey(
  release: ProducerRelease | ProducerReleaseCandidate,
): string {
  return canonicalJson({
    ...(release.modelDispatchProfile == null
      ? {}
      : {
          modelDispatchProfile: parseReviewModelDispatchProfileV2(
            release.modelDispatchProfile,
          ),
        }),
    ...(release.prDescriptionProfile == null
      ? {}
      : {
          prDescriptionProfile: parseProducerPrDescriptionProfile(
            release.prDescriptionProfile,
          ),
        }),
    ...(release.lifecycleVerificationProfile == null
      ? {}
      : {
          lifecycleVerificationProfile:
            parseProducerLifecycleVerificationProfile(
              release.lifecycleVerificationProfile,
            ),
        }),
    distributionKind: release.distributionKind,
    actionCommitSha: release.actionCommitSha,
    runtimeCommitSha: release.runtimeCommitSha,
    wrapperEntrypointDigest: release.wrapperEntrypointDigest,
    runtimeEntrypointDigest: release.runtimeEntrypointDigest,
    contextGatewayPolicyVersion: release.contextGatewayPolicyVersion ?? null,
    contextGatewayEntrypointDigest:
      release.contextGatewayEntrypointDigest ?? null,
    reviewInvestigationCapability:
      release.reviewInvestigationProfile?.capability ?? null,
    reviewInvestigationCoverageProfileHash:
      release.reviewInvestigationProfile?.coverageProfileHash ?? null,
    reviewInvestigationPolicyHash:
      release.reviewInvestigationProfile?.policyHash ?? null,
    agentProfiles: release.agentProfiles ?? null,
    ...(release.contextToolsProfile !== undefined
      ? {
          contextToolsProfile: parseProducerContextToolsProfile(
            release.contextToolsProfile,
          ),
        }
      : {}),
    schemaDigest: release.schemaDigest,
    capabilityProfile: release.capabilityProfile,
    protocolLimitsProfileId: release.protocolLimitsProfileId,
    operationalSloProfileId: release.operationalSloProfileId,
  });
}

export function cloneProducerRelease(
  release: ProducerRelease,
): ProducerRelease {
  return {
    ...release,
    ...(release.contextToolsProfile !== undefined
      ? {
          contextToolsProfile: parseProducerContextToolsProfile(
            release.contextToolsProfile,
          ),
        }
      : {}),
    ...(release.modelDispatchProfile == null
      ? {}
      : {
          modelDispatchProfile: parseReviewModelDispatchProfileV2(
            release.modelDispatchProfile,
          ),
        }),
    ...(release.prDescriptionProfile == null
      ? {}
      : {
          prDescriptionProfile: parseProducerPrDescriptionProfile(
            release.prDescriptionProfile,
          ),
        }),
    ...(release.lifecycleVerificationProfile == null
      ? {}
      : {
          lifecycleVerificationProfile:
            parseProducerLifecycleVerificationProfile(
              release.lifecycleVerificationProfile,
            ),
        }),
    agentProfiles:
      release.agentProfiles == null
        ? null
        : parseReviewAgentProfiles(release.agentProfiles),
    registeredAt: cloneDate(release.registeredAt),
    revokedAt: release.revokedAt ? cloneDate(release.revokedAt) : null,
  };
}

function assertBoundedReferences(
  values: readonly string[],
  field: string,
): void {
  if (values.length > 32) {
    invalid(`${field}_too_many`);
  }
  for (const value of values) {
    assertIdentifier(value, field);
  }
}
