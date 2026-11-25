import { assertLifecycleVerificationWorkSlots } from "./review-lifecycle-verification.js";
import {
  LookupReviewEvidenceStatus,
  reviewReuseEligibilityPolicyVersion,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewInvocationLeasePurpose,
  ReviewObservationAttachmentKind,
  ReviewObservationAttachmentStatus,
  ReviewTaskKind,
} from "@reviewrouter/features-review-executions";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  ReviewExecutionMutationResultStatus,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewExecutionObservationAttachRequest,
} from "@reviewrouter/protocol-review-action-v2";
import {
  attachmentResult,
  mapAttachmentStatus,
  adoptionResult,
} from "./review-action-v2-execution-result-mappers.js";
import { assertNotPrDescriptionEvidence } from "./review-pr-description.js";
import { type ReviewActionV2ExecutionHandlerDependencies } from "./review-action-v2-execution-evidence-dependencies.js";
import {
  assertBodyHash,
  requireAuthorization,
  requireExecution,
  authorizationScopeHash,
  toEvidenceScope,
  toEvidenceRevision,
  toExecutionScope,
  verifyLease,
  assertLeaseAuthorization,
  requireLeaseOwnership,
  requireLease,
  validatePreparedManifest,
} from "./review-action-v2-execution-evidence-authority.js";
import {
  requireEqual,
  failure,
  decimal,
  parseManifest,
} from "./review-action-v2-execution-evidence-validation.js";
import {
  assertAttachmentRequest,
  attachmentPolicyStale,
  reuseAttachmentKind,
  assertLifecycleObservationSource,
  observationRefId,
  assertLifecycleLeaseEvidence,
  assertAdoptionSourceLease,
  assertAdoptionObservation,
  assertAdoptionReplay,
} from "./review-action-v2-execution-evidence-observation-validation.js";

// Observation attachment and adoption orchestration at the API boundary.

export async function attachObservation(
  request: ReviewExecutionObservationAttachRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionObservationAttach,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  const snapshot = await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );

  assertNotPrDescriptionEvidence(snapshot.execution, request.workSlotId);
  const now = d.now();
  try {
    const reusable = await d.capabilities.verifyReusableAttachment(
      request.leaseCapability,
      now,
    );
    requireEqual(
      reusable.authorizationId,
      authorization.authorizationId,
      "attachment_authorization_mismatch",
    );
    requireEqual(
      reusable.scopeHash,
      await authorizationScopeHash(authorization, d.digest),
      "attachment_scope_mismatch",
    );
    requireEqual(
      reusable.mutationEpoch,
      authorization.mutationEpoch,
      "attachment_mutation_epoch_mismatch",
    );
    requireEqual(
      reusable.targetExecutionId,
      request.executionId,
      "attachment_execution_mismatch",
    );
    requireEqual(
      reusable.targetWorkSlotId,
      request.workSlotId,
      "attachment_slot_mismatch",
    );
    requireEqual(
      reusable.targetReviewRevisionHash,
      snapshot.execution.revision.reviewRevisionHash,
      "attachment_revision_mismatch",
    );
    requireEqual(
      reusable.targetPlanHash,
      snapshot.execution.planHash,
      "attachment_plan_mismatch",
    );
    assertAttachmentRequest(request, reusable);
    if (
      reusable.attachmentKind ===
      ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse
    ) {
      if (
        !(await d.contextReplay.verifyAttachment({
          authorization,
          snapshot,
          authority: reusable,
        }))
      ) {
        throw attachmentPolicyStale();
      }
    } else {
      const revalidated = await d.evidence.lookupReviewEvidence.execute({
        scope: toEvidenceScope(
          authorization,
          await authorizationScopeHash(authorization, d.digest),
        ),
        revision: toEvidenceRevision(authorization),
        planHash: reusable.targetPlanHash,
        executionId: reusable.targetExecutionId,
        manifest: reusable.manifest,
        manifestKey: reusable.manifestKey,
        providerInvocationKey: reusable.providerInvocationKey,
        providerVoteIdentityHash: reusable.providerVoteIdentityHash,
        trustDomain: reusable.trustDomain,
      });
      if (
        revalidated.status !== LookupReviewEvidenceStatus.Hit ||
        !revalidated.selected?.canAttach ||
        revalidated.selected.observation.observationId !==
          reusable.observationId ||
        revalidated.selected.reuseSafetyDecisionHash !==
          reusable.reuseSafetyDecisionHash ||
        reuseAttachmentKind(
          revalidated.selected.eligibility,
          revalidated.selected.tier,
        ) !== reusable.attachmentKind ||
        revalidated.selected.observation.sourceExecutionId ===
          request.executionId
      ) {
        throw attachmentPolicyStale();
      }
    }
    const reusableSlot = snapshot.execution.workSlots.find(
      (slot) => slot.workSlotId === request.workSlotId,
    );
    const reusableRuntime = parseReviewRunRuntimeSnapshot(
      authorization.runtimeSnapshotCanonicalJson,
    );
    if (
      reusableSlot &&
      (reusableSlot.taskKind === ReviewTaskKind.LifecycleRevalidation ||
        reusableRuntime?.modelDispatchCapability)
    ) {
      if (reusableSlot.taskKind === ReviewTaskKind.LifecycleRevalidation)
        assertLifecycleVerificationWorkSlots(authorization, [reusableSlot]);
      if (
        reusableRuntime?.lifecycleVerificationCapability ||
        reusableRuntime?.modelDispatchCapability
      ) {
        const reusableObservation = await d.observations.findById(
          request.observationId,
        );
        if (!reusableObservation) throw attachmentPolicyStale();
        await assertLifecycleObservationSource(
          authorization,
          snapshot,
          request.workSlotId,
          reusable.manifest,
          reusableObservation,
          d,
        );
      }
    }
    const result = await d.executions.observationAttachments.attachReusable({
      scope: toExecutionScope(authorization),
      executionId: request.executionId,
      workSlotId: request.workSlotId,
      sourceExecutionId: reusable.sourceExecutionId,
      observationRefId: await observationRefId(request, d),
      observationId: request.observationId,
      providerInvocationKey: request.providerInvocationKey,
      providerVoteIdentityHash: request.providerVoteIdentityHash,
      payloadHash: request.payloadHash,
      byteCount: request.byteCount,
      findingCount: request.findingCount,
      attachmentKind: reusable.attachmentKind,
      eligibilityPolicyVersion: request.eligibilityPolicyVersion,
      reuseSafetyDecisionHash: reusable.reuseSafetyDecisionHash,
      now,
    });
    return {
      statusCode: 200 as const,
      result: attachmentResult(
        result.status,
        request,
        result.snapshot ?? snapshot,
      ),
    };
  } catch (error) {
    if (error instanceof ReviewActionV2RouteFailure) throw error;
  }
  const leaseAuthority = await verifyLease(request.leaseCapability, now, d);
  await assertLeaseAuthorization(leaseAuthority, authorization, d);
  requireLeaseOwnership(leaseAuthority, now);
  const lease = await requireLease(
    leaseAuthority,
    d.executionQueries,
    true,
    now,
  );
  requireEqual(
    lease.executionId,
    request.executionId,
    "lease_execution_mismatch",
  );
  requireEqual(lease.workSlotId, request.workSlotId, "lease_slot_mismatch");
  const observation = await d.observations.findById(request.observationId);
  if (!observation)
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "observation_missing",
    );
  if (
    observation.sourceExecutionId !== request.executionId ||
    observation.sourceLeaseId !== lease.leaseId ||
    observation.attemptId !== lease.attemptId ||
    observation.providerInvocationKey !== request.providerInvocationKey ||
    observation.providerVoteIdentityHash !== request.providerVoteIdentityHash ||
    observation.payloadHash !== request.payloadHash ||
    observation.byteCount !== request.byteCount ||
    observation.findingCount !== request.findingCount ||
    request.eligibilityPolicyVersion !== reviewReuseEligibilityPolicyVersion
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "fresh_observation_authority_mismatch",
    );
  }
  await assertLifecycleLeaseEvidence(
    authorization,
    snapshot,
    request.workSlotId,
    lease,
    observation.payload,
    observation.actualModel,
    d,
  );
  const result = await d.executions.observationAttachments.attachFresh({
    scope: toExecutionScope(authorization),
    executionId: request.executionId,
    workSlotId: request.workSlotId,
    observationRefId: await observationRefId(request, d),
    observationId: request.observationId,
    providerInvocationKey: request.providerInvocationKey,
    providerVoteIdentityHash: request.providerVoteIdentityHash,
    payloadHash: request.payloadHash,
    byteCount: request.byteCount,
    findingCount: request.findingCount,
    eligibilityPolicyVersion: request.eligibilityPolicyVersion,
    leaseId: lease.leaseId,
    ownerIdHash: lease.ownerIdHash,
    leaseCapabilityId: lease.leaseCapabilityId,
    fencingToken: lease.fencingToken,
    now,
  });
  return {
    statusCode: 200 as const,
    result: attachmentResult(
      result.status,
      request,
      result.snapshot ?? snapshot,
    ),
  };
}

export async function adoptObservation(
  request: ReviewExecutionObservationAdoptRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionObservationAdopt,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  const snapshot = await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );

  assertNotPrDescriptionEvidence(snapshot.execution, request.workSlotId);
  requireEqual(
    snapshot.execution.generation,
    decimal(request.executionGeneration),
    "adoption_generation_mismatch",
  );
  requireEqual(
    snapshot.execution.planHash,
    request.planHash,
    "adoption_plan_mismatch",
  );
  requireEqual(
    snapshot.execution.revision.reviewRevisionHash,
    request.reviewRevisionHash,
    "adoption_revision_mismatch",
  );
  requireEqual(
    authorization.reviewRevisionHash,
    request.reviewRevisionHash,
    "adoption_authorization_revision_mismatch",
  );
  const slot = snapshot.execution.workSlots.find(
    (candidate) => candidate.workSlotId === request.workSlotId,
  );
  if (!slot) {
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "work_slot_missing",
    );
  }
  await validatePreparedManifest(
    request,
    authorization,
    slot,
    d,
    snapshot.execution.assignmentManifestCanonicalJson,
  );

  const sourceLease = await d.executionQueries.findLease(request.sourceLeaseId);
  if (!sourceLease) {
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "adoption_source_lease_missing",
    );
  }
  assertAdoptionSourceLease(request, sourceLease, authorization, snapshot);
  const observation = await d.observations.findById(request.observationId);
  if (!observation) {
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "adoption_observation_missing",
    );
  }
  await assertAdoptionObservation(
    request,
    observation,
    sourceLease,
    authorization,
    d.digest,
  );

  await assertLifecycleObservationSource(
    authorization,
    snapshot,
    request.workSlotId,
    parseManifest(request.manifestCanonicalJson),
    observation,
    d,
  );
  const adoptionIdentityHash = await d.digest.digestUtf8(
    canonicalJson({
      authorizationId: authorization.authorizationId,
      executionId: request.executionId,
      executionGeneration: request.executionGeneration,
      workSlotId: request.workSlotId,
      observationId: request.observationId,
      sourceLeaseId: request.sourceLeaseId,
      sourceFencingToken: request.sourceFencingToken,
      idempotencyKey: request.idempotencyKey,
    }),
  );
  const adoptionRequestIdHash = await d.digest.digestUtf8(
    request.idempotencyKey,
  );
  const adoptionLeaseId = `adoption-${adoptionIdentityHash}`;
  const observationRef = await observationRefId(request, d);
  const existingRef = snapshot.observationRefs.find(
    (candidate) => candidate.workSlotId === request.workSlotId,
  );
  if (existingRef) {
    const adoptionLease = await d.executionQueries.findLease(adoptionLeaseId);
    assertAdoptionReplay(
      request,
      existingRef,
      adoptionLease,
      observationRef,
      adoptionIdentityHash,
      adoptionRequestIdHash,
    );
    return {
      statusCode: 200 as const,
      result: adoptionResult(
        ReviewExecutionMutationResultStatus.Restored,
        request,
        snapshot,
        observation,
      ),
    };
  }

  const now = d.now();
  if (now.getTime() > sourceLease.resultReportUntil.getTime()) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "adoption_result_report_expired",
    );
  }
  requireEqual(
    snapshot.stream.version,
    decimal(request.expectedStreamVersion),
    "adoption_stream_version_mismatch",
  );
  if (
    snapshot.execution.version !== decimal(request.expectedExecutionVersion)
  ) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "adoption_execution_version_mismatch",
    );
  }
  const safety = await d.leaseSafety.resolve({
    authorization,
    execution: snapshot.execution,
    workSlotId: request.workSlotId,
    purpose: ReviewInvocationLeasePurpose.ObservationAdoption,
  });
  if (!safety.allowed) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "adoption_safety_rejected",
    );
  }
  const adoptionCapabilityIdentity = await d.capabilities.prepareIdentity();
  const outcome = await d.executions.observationAttachments.adoptAccepted({
    scope: toExecutionScope(authorization),
    executionId: request.executionId,
    expectedStreamVersion: decimal(request.expectedStreamVersion),
    expectedExecutionVersion: decimal(request.expectedExecutionVersion),
    workSlotId: request.workSlotId,
    sourceLeaseId: request.sourceLeaseId,
    sourceFencingToken: decimal(request.sourceFencingToken),
    sourceObservationId: request.observationId,
    observationRefId: observationRef,
    providerInvocationKey: request.providerInvocationKey,
    providerVoteIdentityHash: request.providerVoteIdentityHash,
    payloadHash: request.payloadHash,
    byteCount: request.byteCount,
    findingCount: request.findingCount,
    eligibilityPolicyVersion: request.eligibilityPolicyVersion,
    adoptionLeaseId,
    adoptionAcquireRequestIdHash: adoptionRequestIdHash,
    adoptionAcquireRequestHash: request.requestBodyHash,
    ownerIdHash: request.ownerIdHash,
    leaseCapabilityId: adoptionCapabilityIdentity.capabilityId,
    capabilitySigningKeyId: adoptionCapabilityIdentity.signingKeyId,
    leaseSafetyDecisionHash: safety.decisionHash,
    now,
    retainUntil: new Date(snapshot.execution.retainUntil),
  });
  const resultSnapshot = outcome.snapshot ?? snapshot;
  const status = mapAttachmentStatus(outcome.status);
  return {
    statusCode:
      outcome.status === ReviewObservationAttachmentStatus.Attached
        ? (201 as const)
        : (200 as const),
    result: adoptionResult(
      status,
      request,
      resultSnapshot,
      status === ReviewExecutionMutationResultStatus.Applied ||
        status === ReviewExecutionMutationResultStatus.Restored
        ? observation
        : null,
    ),
  };
}
