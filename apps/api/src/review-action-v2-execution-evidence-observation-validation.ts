import {
  assertLifecycleVerificationWorkSlots,
  assertLifecycleVerificationPreparedPlan,
  assertLifecycleVerificationObservation,
} from "./review-lifecycle-verification.js";
import {
  ReuseEligibility,
  ReviewReuseTier,
  prepareReviewObservationPayload,
  reviewReuseEligibilityPolicyVersion,
  type ProviderInvocationManifest,
  type ReviewObservation,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewObservationAttachmentKind,
  ReviewTaskKind,
  type ReviewExecutionObservationRef,
  type ReviewExecutionSnapshot,
  type ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewActionV2ProtocolErrorCode,
  type ReviewEvidenceLookupRequest,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewExecutionObservationAttachRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type { ReviewActionV2ReusableAttachmentAuthority } from "./review-action-v2-execution-evidence-capabilities.js";
import {
  type CommonDependencies,
  type ReviewActionV2DigestPort,
} from "./review-action-v2-execution-evidence-dependencies.js";
import {
  failure,
  parseManifest,
  requireEqual,
  decimal,
} from "./review-action-v2-execution-evidence-validation.js";
import { authorizationScopeHash } from "./review-action-v2-execution-evidence-authority.js";

// Original observation, lease and lifecycle evidence validation shared by handlers.

/** Companion evidence must originate from its completed durable native claim.
 * Retention/pruning gaps abstain; they never manufacture replacement authority. */
export async function assertLifecycleLeaseEvidence(
  authorization: ReviewRunAuthorization,
  snapshot: ReviewExecutionSnapshot,
  workSlotId: string,
  lease: ReviewInvocationLease,
  payload: unknown,
  actualModel: string,
  d: CommonDependencies,
): Promise<void> {
  const slot = snapshot.execution.workSlots.find(
    (item) => item.workSlotId === workSlotId,
  );
  if (!slot) return;
  const runtime = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  if (runtime?.modelDispatchCapability) {
    const role =
      slot.taskKind === ReviewTaskKind.FindingDiscovery
        ? "finding_discovery"
        : slot.taskKind === ReviewTaskKind.LifecycleRevalidation
          ? "lifecycle_verification"
          : slot.taskKind === ReviewTaskKind.PrDescription
            ? "pr_description"
            : null;
    if (
      !role ||
      !lease.preparedManifestCanonicalJson ||
      !lease.preparedManifestKey ||
      !d.verifyModelDispatchEvidence
    )
      throw failure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        "model_dispatch_proof_unavailable",
      );
    const manifest = parseManifest(lease.preparedManifestCanonicalJson);
    await d.verifyModelDispatchEvidence({
      authorization,
      executionId: snapshot.execution.executionId,
      workSlotId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      preparedManifestKey: lease.preparedManifestKey,
      providerRequestEnvelopeHash: manifest.providerRequestEnvelopeHash,
      actualModel,
      role,
    });
  }
  if (slot.taskKind !== ReviewTaskKind.LifecycleRevalidation) return;
  assertLifecycleVerificationWorkSlots(authorization, [slot]);
  const capability = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  )?.lifecycleVerificationCapability;
  if (!capability) return;
  if (
    !lease.preparedManifestCanonicalJson ||
    !lease.preparedManifestKey ||
    (!runtime?.modelDispatchCapability && !d.verifyLifecycleDispatchEvidence)
  )
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "lifecycle_verification_dispatch_proof_unavailable",
    );
  const manifest = parseManifest(lease.preparedManifestCanonicalJson);
  assertLifecycleVerificationPreparedPlan(
    authorization,
    snapshot.execution.assignmentManifestCanonicalJson
      ? JSON.parse(snapshot.execution.assignmentManifestCanonicalJson)
      : null,
    slot,
    manifest,
  );
  assertLifecycleVerificationObservation(
    authorization,
    slot,
    manifest,
    payload,
  );
  requireEqual(
    actualModel,
    capability.model,
    "lifecycle_verification_actual_model_mismatch",
  );
  if (runtime?.modelDispatchCapability) return;
  await d.verifyLifecycleDispatchEvidence!({
    authorization,
    executionId: snapshot.execution.executionId,
    workSlotId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    preparedManifestKey: lease.preparedManifestKey,
    providerRequestEnvelopeHash: manifest.providerRequestEnvelopeHash,
  });
}

export async function assertLifecycleObservationSource(
  authorization: ReviewRunAuthorization,
  target: ReviewExecutionSnapshot,
  workSlotId: string,
  manifest: ProviderInvocationManifest,
  observation: ReviewObservation,
  d: CommonDependencies,
): Promise<void> {
  const slot = target.execution.workSlots.find(
    (item) => item.workSlotId === workSlotId,
  );
  const runtime = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  if (
    !slot ||
    (slot.taskKind !== ReviewTaskKind.LifecycleRevalidation &&
      !runtime?.modelDispatchCapability)
  )
    return;
  if (slot.taskKind === ReviewTaskKind.LifecycleRevalidation)
    assertLifecycleVerificationPreparedPlan(
      authorization,
      target.execution.assignmentManifestCanonicalJson
        ? JSON.parse(target.execution.assignmentManifestCanonicalJson)
        : null,
      slot,
      manifest,
    );
  if (
    !runtime?.lifecycleVerificationCapability &&
    !runtime?.modelDispatchCapability
  )
    return;
  const [source, sourceLease, sourceAuthorization] = await Promise.all([
    d.executionQueries.findExecution(observation.sourceExecutionId),
    d.executionQueries.findLease(observation.sourceLeaseId),
    d.authorizationQueries?.findReviewRunAuthorizationById(
      observation.sourceAuthorizationId,
    ),
  ]);
  if (
    !source ||
    !sourceLease ||
    !sourceAuthorization ||
    source.execution.authorizationId !== sourceAuthorization.authorizationId ||
    sourceLease.executionId !== source.execution.executionId ||
    sourceLease.workSlotId !== observation.sourceWorkSlotId ||
    sourceLease.preparedManifestKey !== observation.manifestKey ||
    sourceLease.fencingToken.toString(10) !== observation.sourceFencingToken ||
    sourceLease.providerInvocationKey !== observation.providerInvocationKey ||
    sourceAuthorization.reviewRevisionHash !==
      authorization.reviewRevisionHash ||
    (!runtime?.modelDispatchCapability &&
      !parseReviewRunRuntimeSnapshot(
        sourceAuthorization.runtimeSnapshotCanonicalJson,
      )?.lifecycleVerificationCapability)
  )
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "lifecycle_verification_original_source_unavailable",
    );
  if (runtime?.modelDispatchCapability) {
    const sourceRoute = parseReviewRunRuntimeSnapshot(
      sourceAuthorization.runtimeSnapshotCanonicalJson,
    )?.modelDispatchCapability;
    if (
      !sourceRoute ||
      sourceRoute.routeIdentityHash !==
        runtime.modelDispatchCapability.routeIdentityHash ||
      sourceRoute.model !== runtime.modelDispatchCapability.model ||
      sourceRoute.transport !== runtime.modelDispatchCapability.transport
    )
      throw failure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        "model_dispatch_original_source_unavailable",
      );
  }
  await assertLifecycleLeaseEvidence(
    sourceAuthorization,
    source,
    observation.sourceWorkSlotId,
    sourceLease,
    observation.payload,
    observation.actualModel,
    d,
  );
}

export function assertAttachmentRequest(
  r: ReviewExecutionObservationAttachRequest,
  a: ReviewActionV2ReusableAttachmentAuthority,
) {
  requireEqual(
    r.observationId,
    a.observationId,
    "attachment_observation_mismatch",
  );
  requireEqual(
    r.providerInvocationKey,
    a.providerInvocationKey,
    "attachment_invocation_mismatch",
  );
  requireEqual(
    r.providerVoteIdentityHash,
    a.providerVoteIdentityHash,
    "attachment_vote_mismatch",
  );
  requireEqual(r.payloadHash, a.payloadHash, "attachment_payload_mismatch");
  requireEqual(r.byteCount, a.byteCount, "attachment_byte_count_mismatch");
  requireEqual(
    r.findingCount,
    a.findingCount,
    "attachment_finding_count_mismatch",
  );
  requireEqual(
    r.eligibilityPolicyVersion,
    a.eligibilityPolicyVersion,
    "attachment_policy_mismatch",
  );
}

export function attachmentPolicyStale(): ReviewActionV2RouteFailure {
  return failure(
    412,
    ReviewActionV2ProtocolErrorCode.StalePrecondition,
    "attachment_policy_stale",
  );
}

export function assertAdoptionSourceLease(
  request: ReviewExecutionObservationAdoptRequest,
  sourceLease: ReviewInvocationLease,
  authorization: ReviewRunAuthorization,
  snapshot: ReviewExecutionSnapshot,
) {
  if (
    sourceLease.state === ReviewInvocationLeaseState.Revoked ||
    sourceLease.purpose !== ReviewInvocationLeasePurpose.ProviderExecution ||
    sourceLease.attemptId === null ||
    sourceLease.executionId !== request.executionId ||
    sourceLease.executionGeneration !== decimal(request.executionGeneration) ||
    sourceLease.workSlotId !== request.workSlotId ||
    sourceLease.leaseId !== request.sourceLeaseId ||
    sourceLease.fencingToken !== decimal(request.sourceFencingToken) ||
    sourceLease.ownerIdHash !== request.ownerIdHash ||
    sourceLease.authorizationId !== authorization.authorizationId ||
    sourceLease.producerReleaseId !== authorization.producerReleaseId ||
    sourceLease.mutationEpoch !== authorization.mutationEpoch ||
    sourceLease.reviewRevisionHash !== request.reviewRevisionHash ||
    sourceLease.providerInvocationKey !== request.providerInvocationKey ||
    sourceLease.providerVoteIdentityHash !== request.providerVoteIdentityHash ||
    sourceLease.preparedManifestCanonicalJson !==
      request.manifestCanonicalJson ||
    sourceLease.preparedManifestKey !== request.manifestKey ||
    snapshot.execution.executionId !== sourceLease.executionId
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "adoption_source_lease_authority_mismatch",
    );
  }
}

export async function isAdoptionLookupSourceValid(input: {
  readonly request: ReviewEvidenceLookupRequest;
  readonly authorization: ReviewRunAuthorization;
  readonly snapshot: ReviewExecutionSnapshot;
  readonly observation: ReviewObservation;
  readonly sourceLease: ReviewInvocationLease;
  readonly scopeHash: string;
  readonly now: Date;
  readonly digest: ReviewActionV2DigestPort;
}): Promise<boolean> {
  const { request, authorization, snapshot, observation, sourceLease } = input;
  const prepared = prepareReviewObservationPayload(observation.payload);
  return (
    sourceLease.state !== ReviewInvocationLeaseState.Revoked &&
    sourceLease.purpose === ReviewInvocationLeasePurpose.ProviderExecution &&
    sourceLease.attemptId !== null &&
    sourceLease.resultReportUntil >= input.now &&
    sourceLease.executionId === request.executionId &&
    sourceLease.executionGeneration === snapshot.execution.generation &&
    sourceLease.workSlotId === request.workSlotId &&
    sourceLease.leaseId === observation.sourceLeaseId &&
    sourceLease.fencingToken.toString(10) === observation.sourceFencingToken &&
    sourceLease.authorizationId === authorization.authorizationId &&
    sourceLease.producerReleaseId === authorization.producerReleaseId &&
    sourceLease.mutationEpoch === authorization.mutationEpoch &&
    sourceLease.reviewRevisionHash === authorization.reviewRevisionHash &&
    sourceLease.providerInvocationKey === request.providerInvocationKey &&
    sourceLease.providerVoteIdentityHash === request.providerVoteIdentityHash &&
    sourceLease.preparedManifestCanonicalJson ===
      request.manifestCanonicalJson &&
    sourceLease.preparedManifestKey === request.manifestKey &&
    observation.sourceExecutionId === request.executionId &&
    observation.attemptId === sourceLease.attemptId &&
    observation.manifestKey === request.manifestKey &&
    observation.providerInvocationKey === request.providerInvocationKey &&
    observation.providerVoteIdentityHash === request.providerVoteIdentityHash &&
    observation.scope.workspaceId === authorization.workspaceId &&
    observation.scope.repositoryConnectionId ===
      authorization.repositoryConnectionId &&
    observation.scope.scmRepositoryIdentityId ===
      authorization.scmRepositoryIdentityId &&
    observation.scope.pullRequestNumber === authorization.pullRequestNumber &&
    observation.scope.authorizationScopeHash === input.scopeHash &&
    observation.sourceRevision.reviewRevisionHash ===
      authorization.reviewRevisionHash &&
    (await input.digest.digest(prepared.canonicalBytes)) ===
      observation.payloadHash &&
    prepared.byteCount === observation.byteCount &&
    prepared.findingCount === observation.findingCount
  );
}

export async function assertAdoptionObservation(
  request: ReviewExecutionObservationAdoptRequest,
  observation: ReviewObservation,
  sourceLease: ReviewInvocationLease,
  authorization: ReviewRunAuthorization,
  digest: ReviewActionV2DigestPort,
) {
  const prepared = prepareReviewObservationPayload(observation.payload);
  if (
    observation.observationId !== request.observationId ||
    observation.sourceExecutionId !== request.executionId ||
    observation.sourceLeaseId !== request.sourceLeaseId ||
    observation.sourceFencingToken !== request.sourceFencingToken ||
    observation.attemptId !== sourceLease.attemptId ||
    observation.manifestKey !== request.manifestKey ||
    observation.providerInvocationKey !== request.providerInvocationKey ||
    observation.providerVoteIdentityHash !== request.providerVoteIdentityHash ||
    observation.payloadHash !== request.payloadHash ||
    observation.byteCount !== request.byteCount ||
    observation.findingCount !== request.findingCount ||
    observation.scope.workspaceId !== authorization.workspaceId ||
    observation.scope.repositoryConnectionId !==
      authorization.repositoryConnectionId ||
    observation.scope.scmRepositoryIdentityId !==
      authorization.scmRepositoryIdentityId ||
    observation.scope.pullRequestNumber !== authorization.pullRequestNumber ||
    observation.scope.authorizationScopeHash !==
      (await authorizationScopeHash(authorization, digest)) ||
    observation.sourceRevision.reviewRevisionHash !==
      request.reviewRevisionHash ||
    request.eligibilityPolicyVersion !== reviewReuseEligibilityPolicyVersion ||
    (await digest.digest(prepared.canonicalBytes)) !==
      observation.payloadHash ||
    prepared.byteCount !== observation.byteCount ||
    prepared.findingCount !== observation.findingCount
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "adoption_observation_authority_mismatch",
    );
  }
}

export function assertAdoptionReplay(
  request: ReviewExecutionObservationAdoptRequest,
  existingRef: ReviewExecutionObservationRef,
  adoptionLease: ReviewInvocationLease | null,
  observationRefId: string,
  adoptionIdentityHash: string,
  adoptionRequestIdHash: string,
) {
  if (
    existingRef.observationRefId !== observationRefId ||
    existingRef.observationId !== request.observationId ||
    existingRef.executionId !== request.executionId ||
    existingRef.workSlotId !== request.workSlotId ||
    existingRef.providerInvocationKey !== request.providerInvocationKey ||
    existingRef.providerVoteIdentityHash !== request.providerVoteIdentityHash ||
    existingRef.payloadHash !== request.payloadHash ||
    existingRef.byteCount !== request.byteCount ||
    existingRef.findingCount !== request.findingCount ||
    existingRef.eligibilityPolicyVersion !== request.eligibilityPolicyVersion ||
    existingRef.attachmentKind !==
      ReviewObservationAttachmentKind.ObservationAdoption ||
    existingRef.sourceLeaseId !== request.sourceLeaseId ||
    existingRef.sourceFencingToken !== decimal(request.sourceFencingToken) ||
    adoptionLease === null ||
    adoptionLease.leaseId !== `adoption-${adoptionIdentityHash}` ||
    adoptionLease.purpose !==
      ReviewInvocationLeasePurpose.ObservationAdoption ||
    adoptionLease.state !== ReviewInvocationLeaseState.Released ||
    adoptionLease.sourceObservationId !== request.observationId ||
    adoptionLease.providerInvocationKey !== request.providerInvocationKey ||
    adoptionLease.providerVoteIdentityHash !==
      request.providerVoteIdentityHash ||
    adoptionLease.ownerIdHash !== request.ownerIdHash ||
    adoptionLease.acquireRequestIdHash !== adoptionRequestIdHash ||
    adoptionLease.acquireRequestHash !== request.requestBodyHash ||
    !isCapabilityIdentifier(adoptionLease.leaseCapabilityId) ||
    !isCapabilityIdentifier(adoptionLease.capabilitySigningKeyId)
  ) {
    throw failure(
      409,
      ReviewActionV2ProtocolErrorCode.IdempotencyConflict,
      "adoption_replay_conflict",
    );
  }
}

function isCapabilityIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

export async function observationRefId(
  r: Pick<
    ReviewExecutionObservationAttachRequest,
    "executionId" | "workSlotId" | "observationId"
  >,
  d: CommonDependencies,
) {
  return `obsref:${await d.digest.digestUtf8(canonicalJson({ executionId: r.executionId, workSlotId: r.workSlotId, observationId: r.observationId }))}`;
}

export function reuseAttachmentKind(
  eligibility: ReuseEligibility,
  tier: ReviewReuseTier,
) {
  if (
    eligibility === ReuseEligibility.ExactRevision &&
    tier === ReviewReuseTier.T0ExactRevision
  )
    return ReviewObservationAttachmentKind.ExactRevisionReuse;
  if (
    eligibility === ReuseEligibility.PromptOnlyCrossRevision &&
    tier === ReviewReuseTier.T1PromptOnlyCrossRevision
  )
    return ReviewObservationAttachmentKind.PromptOnlyCrossRevisionReuse;
  throw failure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    "reuse_tier_not_attachable",
  );
}
