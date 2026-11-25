import { assertLifecycleVerificationPreparedPlan } from "./review-lifecycle-verification.js";
import type {
  ReviewInvocationLease,
  ReviewObservationAttachmentKind,
} from "@reviewrouter/features-review-executions";
import {
  AcceptReviewObservationStatus,
  LookupReviewEvidenceStatus,
  ProviderResultCompletionStatus,
  ReviewObservationQualityFlag,
  prepareReviewObservationPayload,
  reviewReuseEligibilityPolicyVersion,
  type ReviewObservation,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  ReviewEvidenceLookupResultStatus,
  type ReviewEvidenceCommitRequest,
  type ReviewEvidenceLookupRequest,
} from "@reviewrouter/protocol-review-action-v2";
import {
  canonicalPayload,
  mapLookup,
  mapCommit,
} from "./review-action-v2-execution-result-mappers.js";
import { assertNotPrDescriptionEvidence } from "./review-pr-description.js";
import { type ReviewActionV2EvidenceHandlerDependencies } from "./review-action-v2-execution-evidence-dependencies.js";
import {
  requireAuthorization,
  requireExecution,
  authorizedVote,
  authorizationScopeHash,
  evidenceTrustDomain,
  toEvidenceScope,
  toEvidenceRevision,
  requireProtocolLimits,
  assertBodyHash,
  verifyLease,
  assertLeaseAuthorization,
  requireLeaseRequest,
  requireLease,
} from "./review-action-v2-execution-evidence-authority.js";
import {
  requireEqual,
  failure,
  parseManifest,
  assertCapturedReviewerManifest,
  required,
  minDate,
  add,
  decimal,
  parsePayload,
  enumValue,
} from "./review-action-v2-execution-evidence-validation.js";
import {
  assertLifecycleObservationSource,
  isAdoptionLookupSourceValid,
  reuseAttachmentKind,
  assertLifecycleLeaseEvidence,
} from "./review-action-v2-execution-evidence-observation-validation.js";

// Evidence lookup and commitment with retained authorization and source validation.

export async function lookupEvidence(
  request: ReviewEvidenceLookupRequest,
  d: ReviewActionV2EvidenceHandlerDependencies,
) {
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
    snapshot.execution.planHash,
    request.planHash,
    "plan_hash_mismatch",
  );
  const slot = snapshot.execution.workSlots.find(
    (item) => item.workSlotId === request.workSlotId,
  );
  if (!slot)
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "work_slot_missing",
    );
  requireEqual(
    slot.providerVoteIdentityHash,
    request.providerVoteIdentityHash,
    "provider_vote_slot_mismatch",
  );
  authorizedVote(authorization, request.providerVoteIdentityHash);
  const manifest = parseManifest(request.manifestCanonicalJson);
  assertCapturedReviewerManifest(authorization, slot, manifest);
  const scopeHash = await authorizationScopeHash(authorization, d.digest);
  requireEqual(manifest.scopeHash, scopeHash, "manifest_scope_mismatch");
  requireEqual(
    manifest.producerReleaseId,
    authorization.producerReleaseId,
    "manifest_release_mismatch",
  );
  requireEqual(
    manifest.selectedProtocolVersion,
    authorization.selectedProtocolVersion,
    "manifest_protocol_mismatch",
  );
  assertLifecycleVerificationPreparedPlan(
    authorization,
    snapshot.execution.assignmentManifestCanonicalJson
      ? JSON.parse(snapshot.execution.assignmentManifestCanonicalJson)
      : null,
    slot,
    manifest,
  );
  const trustDomain = evidenceTrustDomain(authorization.trustDomain);
  const result = await d.evidence.lookupReviewEvidence.execute({
    scope: toEvidenceScope(authorization, scopeHash),
    revision: toEvidenceRevision(authorization),
    planHash: request.planHash,
    executionId: request.executionId,
    manifest,
    manifestKey: request.manifestKey,
    providerInvocationKey: request.providerInvocationKey,
    providerVoteIdentityHash: request.providerVoteIdentityHash,
    trustDomain,
  });
  const selected = result.selected;
  const profile = await requireProtocolLimits(authorization, d);
  if (
    !selected ||
    selected.observation.byteCount > profile.maxObservationBytes ||
    selected.observation.findingCount > profile.maxObservationFindings
  ) {
    return {
      statusCode: 200 as const,
      result: {
        status: ReviewEvidenceLookupResultStatus.Miss,
        denialReasons: selected
          ? [...result.denialReasons, "payload_limit_exceeded"]
          : result.denialReasons,
      },
    };
  }
  const observation = selected.observation;
  if (
    result.status === LookupReviewEvidenceStatus.Shadow &&
    observation.sourceExecutionId !== request.executionId
  ) {
    const replay = await d.contextReplay.prepareReplay({
      authorization,
      snapshot,
      workSlotId: request.workSlotId,
      manifest,
      manifestKey: request.manifestKey,
      providerInvocationKey: request.providerInvocationKey,
      providerVoteIdentityHash: request.providerVoteIdentityHash,
      trustDomain,
      observation,
    });
    if (replay) {
      return {
        statusCode: 200 as const,
        result: {
          status: ReviewEvidenceLookupResultStatus.ReplayRequired,
          ...lookupObservationFields(observation),
          reuseSafetyDecisionHash: selected.reuseSafetyDecisionHash,
          eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
          ...replay,
          denialReasons: result.denialReasons,
        },
      };
    }
  }
  await assertLifecycleObservationSource(
    authorization,
    snapshot,
    request.workSlotId,
    manifest,
    observation,
    d,
  );
  let adoptionSourceLease: ReviewInvocationLease | null = null;
  if (observation.sourceExecutionId === request.executionId) {
    adoptionSourceLease = await d.executionQueries.findLease(
      observation.sourceLeaseId,
    );
    if (
      adoptionSourceLease === null ||
      !(await isAdoptionLookupSourceValid({
        request,
        authorization,
        snapshot,
        observation,
        sourceLease: adoptionSourceLease,
        scopeHash,
        now: d.now(),
        digest: d.digest,
      }))
    ) {
      return {
        statusCode: 200 as const,
        result: {
          status: ReviewEvidenceLookupResultStatus.Miss,
          denialReasons: [
            ...result.denialReasons,
            "adoption_source_facts_unavailable",
          ],
        },
      };
    }
  }
  let attachmentCapability: string | null = null;
  let attachmentKind: ReviewObservationAttachmentKind | null = null;
  if (
    result.status === LookupReviewEvidenceStatus.Hit &&
    selected.canAttach &&
    observation.sourceExecutionId !== request.executionId
  ) {
    attachmentKind = reuseAttachmentKind(selected.eligibility, selected.tier);
    const now = d.now();
    attachmentCapability = await d.capabilities.issueReusableAttachment(
      {
        authorizationId: authorization.authorizationId,
        mutationEpoch: authorization.mutationEpoch,
        scopeHash,
        targetExecutionId: request.executionId,
        targetWorkSlotId: request.workSlotId,
        targetReviewRevisionHash: authorization.reviewRevisionHash,
        targetPlanHash: request.planHash,
        observationId: observation.observationId,
        sourceExecutionId: observation.sourceExecutionId,
        manifest,
        manifestKey: request.manifestKey,
        providerInvocationKey: request.providerInvocationKey,
        providerVoteIdentityHash: request.providerVoteIdentityHash,
        payloadHash: observation.payloadHash,
        byteCount: observation.byteCount,
        findingCount: observation.findingCount,
        attachmentKind,
        reuseSafetyDecisionHash: required(
          selected.reuseSafetyDecisionHash,
          "reuse_safety_decision_missing",
        ),
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
        trustDomain,
        expiresAt: minDate(
          add(now, d.timing.attachmentCapabilityDurationMs),
          new Date(observation.reuseExpiresAtMs),
          authorization.expiresAt,
        ),
      },
      now,
    );
  }
  return {
    statusCode: 200 as const,
    result: {
      status: mapLookup(result.status),
      ...lookupObservationFields(observation),
      attachmentCapability,
      attachmentKind,
      reuseSafetyDecisionHash: selected.reuseSafetyDecisionHash,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      sourceLeaseId: adoptionSourceLease?.leaseId ?? null,
      sourceFencingToken:
        adoptionSourceLease?.fencingToken.toString(10) ?? null,
      sourceOwnerIdHash: adoptionSourceLease?.ownerIdHash ?? null,
      denialReasons: result.denialReasons,
    },
  };
}

function lookupObservationFields(observation: ReviewObservation) {
  return {
    observationId: observation.observationId,
    payloadHash: observation.payloadHash,
    payloadCanonicalJson: canonicalPayload(observation),
    byteCount: observation.byteCount,
    findingCount: observation.findingCount,
    actualModel: observation.actualModel,
    qualityFlags: observation.qualityFlags,
    transportAttemptCount: observation.transportAttemptCount,
  } as const;
}

export async function commitEvidence(
  request: ReviewEvidenceCommitRequest,
  d: ReviewActionV2EvidenceHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewEvidenceCommit,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  const now = d.now();
  const authority = await verifyLease(request.leaseCapability, now, d);
  await assertLeaseAuthorization(authority, authorization, d);
  requireLeaseRequest(authority, request.sourceLeaseId, request.ownerIdHash);
  requireEqual(
    authority.attemptId,
    request.attemptId,
    "lease_attempt_mismatch",
  );
  const lease = await requireLease(authority, d.executionQueries, false, now);
  requireEqual(
    lease.fencingToken,
    decimal(request.fencingToken),
    "lease_fencing_mismatch",
  );
  const payload = parsePayload(request.payloadCanonicalJson);
  const prepared = prepareReviewObservationPayload(payload);
  requireEqual(
    await d.digest.digest(prepared.canonicalBytes),
    request.payloadHash,
    "payload_hash_mismatch",
  );
  const sourceSnapshot = await requireExecution(
    authority.executionId,
    authorization,
    d.executionQueries,
  );
  await assertLifecycleLeaseEvidence(
    authorization,
    sourceSnapshot,
    lease.workSlotId,
    lease,
    payload,
    request.actualModel,
    d,
  );
  const result = await d.evidence.acceptReviewObservation.execute({
    attemptId: request.attemptId,
    leaseCapabilityId: authority.capabilityId,
    sourceLeaseId: request.sourceLeaseId,
    ownerIdHash: request.ownerIdHash,
    sourceFencingToken: request.fencingToken,
    completionStatus: enumValue(
      ProviderResultCompletionStatus,
      request.completionStatus,
      "completion_status_invalid",
    ),
    schemaValidated: request.schemaValidated,
    fullyConsumed: request.fullyConsumed,
    actualModel: request.actualModel,
    payload,
    qualityFlags: request.qualityFlags.map((flag) =>
      enumValue(ReviewObservationQualityFlag, flag, "quality_flag_invalid"),
    ),
    transportAttemptCount: request.transportAttemptCount,
    contextDependencyAttestationId: request.contextDependencyAttestationId,
    contextDependencyAttestationHash: request.contextDependencyAttestationHash,
    investigationCertificateId: request.investigationCertificateId,
    investigationCertificateHash: request.investigationCertificateHash,
  });
  return {
    statusCode:
      result.status === AcceptReviewObservationStatus.Accepted
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapCommit(result.status),
      observationId: result.observation?.observationId ?? null,
      historicalOnly: result.historicalOnly ?? false,
      eligibilityPolicyVersion: result.eligibilityPolicyVersion ?? null,
      rejectionReason:
        result.status === AcceptReviewObservationStatus.Rejected
          ? result.reason
          : null,
    },
  };
}
