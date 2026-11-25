import {
  AcquireOrJoinInvocationFlightStatus,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewInvocationLeaseTransitionStatus,
  ReviewTaskKind,
  type ReviewExecution,
  type ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import { ReviewRunAuthorizationState } from "@reviewrouter/features-review-run-control";
import {
  canonicalizeReviewActionV2RequestForSlot,
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  type ReviewInvocationLeaseAcquireRequest,
  type ReviewInvocationLeaseReleaseRequest,
  type ReviewInvocationLeaseRenewRequest,
} from "@reviewrouter/protocol-review-action-v2";
import {
  mapInvocationFlightAcquire,
  mapInvocationFlightAcquireRejectionReason,
  leaseTransitionResult,
} from "./review-action-v2-execution-result-mappers.js";
import {
  type ReviewActionV2ExecutionHandlerDependencies,
  type LeaseAuthorizationBinding,
} from "./review-action-v2-execution-evidence-dependencies.js";
import {
  assertBodyHash,
  requireAuthorization,
  requireExecution,
  toExecutionScope,
  requireCurrentExecutionRevision,
  validatePreparedManifest,
  executionLimits,
  verifyLease,
  requireLeaseRequest,
  requireLeaseOwnership,
  requireLease,
  scopeFromSnapshot,
  executionLimitsForProfile,
  assertLeaseAuthorization,
  sameExecutionAuthority,
} from "./review-action-v2-execution-evidence-authority.js";
import {
  enumValue,
  failure,
  minDate,
  add,
  decimal,
} from "./review-action-v2-execution-evidence-validation.js";

// Invocation lease acquisition, renewal and release with current-authority checks.

export async function acquireLease(
  request: ReviewInvocationLeaseAcquireRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
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
  const executionScope = toExecutionScope(authorization);
  await requireCurrentExecutionRevision(
    { scope: executionScope, executionId: request.executionId },
    d,
  );
  const purpose = enumValue(
    ReviewInvocationLeasePurpose,
    request.purpose,
    "lease_purpose_invalid",
  );
  if (purpose !== ReviewInvocationLeasePurpose.ProviderExecution)
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "adoption_requires_dedicated_flow",
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
  const { scopeHash } = await validatePreparedManifest(
    request,
    authorization,
    slot,
    d,
    snapshot.execution.assignmentManifestCanonicalJson,
  );
  const safety = await d.leaseSafety.resolve({
    authorization,
    execution: snapshot.execution,
    workSlotId: request.workSlotId,
    purpose,
  });
  if (!safety.allowed)
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "lease_safety_rejected",
    );
  const limits = await executionLimits(authorization, d);
  const identity = await d.capabilities.prepareIdentity();
  const now = d.now();
  const notAfter = minDate(
    authorization.expiresAt,
    authorization.maxExpiresAt,
    snapshot.execution.executionDeadlineAt,
  );
  if (notAfter <= now)
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "lease_authorization_deadline_invalid",
    );
  const result = await d.executions.invocationFlights.execute({
    scope: executionScope,
    executionId: request.executionId,
    workSlotId: request.workSlotId,
    purpose,
    providerInvocationKey: request.providerInvocationKey,
    preparedManifestCanonicalJson: request.manifestCanonicalJson,
    preparedManifestKey: request.manifestKey,
    providerVoteIdentityHash: request.providerVoteIdentityHash,
    leaseId: d.nextId("lease"),
    attemptId: d.nextId("attempt"),
    sourceObservationId: null,
    acquireRequestIdHash: await d.digest.digestUtf8(request.acquireRequestId),
    acquireRequestHash: await d.digest.digestUtf8(
      canonicalizeReviewActionV2RequestForSlot(
        ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
        request,
      ),
    ),
    ownerIdHash: request.ownerIdHash,
    leaseCapabilityId: identity.capabilityId,
    capabilitySigningKeyId: identity.signingKeyId,
    leaseSafetyDecisionHash: safety.decisionHash,
    now,
    expiresAt: minDate(
      add(
        now,
        Math.min(
          limits.maxLeaseDurationMs,
          d.timing.initialLeaseDurationMs,
          slot.taskKind === ReviewTaskKind.PrDescription
            ? 60_000
            : Number.POSITIVE_INFINITY,
        ),
      ),
      notAfter,
    ),
    resultReportUntil: minDate(
      add(now, limits.maxResultReportDurationMs),
      notAfter,
    ),
    notAfter,
    retainUntil: add(now, d.timing.retentionDurationMs),
    limits,
  });
  if (
    result.status !== AcquireOrJoinInvocationFlightStatus.OwnerAcquired &&
    result.status !== AcquireOrJoinInvocationFlightStatus.OwnerRestored &&
    result.status !== AcquireOrJoinInvocationFlightStatus.TakenOver
  ) {
    return {
      statusCode: 200 as const,
      result: {
        status: mapInvocationFlightAcquire(result.status),
        rejectionReason: mapInvocationFlightAcquireRejectionReason(
          result.status,
        ),
      },
    };
  }
  if (!result.flight) throw new Error("review_invocation_flight_owner_missing");
  const lease = await d.executionQueries.findLease(result.flight.ownerLeaseId);
  if (
    !lease ||
    lease.leaseId !== result.flight.ownerLeaseId ||
    lease.executionId !== result.flight.executionId ||
    lease.workSlotId !== result.flight.workSlotId ||
    lease.fencingToken !== result.flight.fencingToken ||
    lease.state !== ReviewInvocationLeaseState.Active
  ) {
    throw new Error("review_invocation_flight_owner_lease_invalid");
  }
  try {
    await requireCurrentExecutionRevision(
      { scope: executionScope, executionId: request.executionId },
      d,
    );
    await requireCurrentLeaseAuthority(
      {
        authorizationId: authorization.authorizationId,
        scopeHash,
        reviewRevisionHash: authorization.reviewRevisionHash,
        mutationEpoch: authorization.mutationEpoch,
      },
      lease,
      snapshot.execution,
      d,
    );
  } catch (error) {
    await d.executions.invocationLeases.release({
      leaseId: lease.leaseId,
      ownerIdHash: lease.ownerIdHash,
      leaseCapabilityId: lease.leaseCapabilityId,
      fencingToken: lease.fencingToken,
      now: d.now(),
    });
    throw error;
  }
  const leaseCapability = await d.capabilities.issueLease(lease, scopeHash);
  return {
    statusCode:
      result.status === AcquireOrJoinInvocationFlightStatus.OwnerAcquired ||
      result.status === AcquireOrJoinInvocationFlightStatus.TakenOver
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapInvocationFlightAcquire(result.status),
      leaseId: lease.leaseId,
      attemptId: lease.attemptId,
      leaseCapability,
      fencingToken: lease.fencingToken.toString(10),
      expiresAt: lease.expiresAt.toISOString(),
      resultReportUntil: lease.resultReportUntil.toISOString(),
    },
  };
}

export async function renewLease(
  request: ReviewInvocationLeaseRenewRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
    request,
    d.digest,
  );
  const now = d.now();
  const authority = await verifyLease(request.leaseCapability, now, d);
  requireLeaseRequest(authority, request.leaseId, request.ownerIdHash);
  requireLeaseOwnership(authority, now);
  const lease = await requireLease(authority, d.executionQueries, false, now);
  const snapshot = await d.executionQueries.findExecution(lease.executionId);
  if (!snapshot)
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "execution_missing",
    );
  if (snapshot.execution.authorizationId !== authority.authorizationId)
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "lease_authorization_mismatch",
    );
  const executionScope = scopeFromSnapshot(snapshot);
  await requireCurrentExecutionRevision(
    { scope: executionScope, executionId: snapshot.execution.executionId },
    d,
  );
  const limits = await executionLimitsForProfile(
    snapshot.execution.protocolLimitsProfileId,
    d,
  );
  const renewRequestIdHash = await d.digest.digestUtf8(request.renewRequestId);
  const hardDeadline = await requireCurrentLeaseAuthority(
    authority,
    lease,
    snapshot.execution,
    d,
  );
  const auxiliaryDeadline = snapshot.execution.workSlots.some(
    (slot) =>
      slot.workSlotId === lease.workSlotId &&
      slot.taskKind === ReviewTaskKind.PrDescription,
  )
    ? add(lease.acquiredAt, 60_000)
    : hardDeadline;
  const renewalNow = d.now();
  const leaseDurationMs = Math.min(
    d.timing.initialLeaseDurationMs,
    limits.maxLeaseDurationMs,
  );
  const result = await d.executions.invocationLeases.renew({
    leaseId: lease.leaseId,
    ownerIdHash: request.ownerIdHash,
    leaseCapabilityId: authority.capabilityId,
    fencingToken: decimal(request.fencingToken),
    renewRequestIdHash,
    renewRequestHash: request.requestBodyHash,
    now: renewalNow,
    expiresAt: minDate(
      add(renewalNow, leaseDurationMs),
      hardDeadline,
      auxiliaryDeadline,
    ),
    resultReportUntil: minDate(
      add(renewalNow, limits.maxResultReportDurationMs),
      hardDeadline,
    ),
    limits,
  });
  if (
    result.status === ReviewInvocationLeaseTransitionStatus.IdempotencyConflict
  ) {
    throw failure(
      409,
      ReviewActionV2ProtocolErrorCode.IdempotencyConflict,
      "lease_renewal_replay_conflict",
    );
  }
  if (result.lease) {
    try {
      await requireCurrentExecutionRevision(
        {
          scope: executionScope,
          executionId: snapshot.execution.executionId,
        },
        d,
      );
      await requireCurrentLeaseAuthority(
        authority,
        result.lease,
        snapshot.execution,
        d,
      );
    } catch (error) {
      await d.executions.invocationLeases.release({
        leaseId: result.lease.leaseId,
        ownerIdHash: result.lease.ownerIdHash,
        leaseCapabilityId: result.lease.leaseCapabilityId,
        fencingToken: result.lease.fencingToken,
        now: d.now(),
      });
      throw error;
    }
  }
  const leaseCapability = result.lease
    ? await d.capabilities.issueLease(
        result.lease,
        authority.scopeHash,
        result.lease.renewedAt,
      )
    : null;
  return {
    statusCode: 200 as const,
    result: {
      ...leaseTransitionResult(result.status, result.lease),
      leaseCapability,
    },
  };
}

async function requireCurrentLeaseAuthority(
  authority: LeaseAuthorizationBinding,
  lease: ReviewInvocationLease,
  execution: ReviewExecution,
  d: ReviewActionV2ExecutionHandlerDependencies,
): Promise<Date> {
  const authorization =
    await d.authorizationQueries.findReviewRunAuthorizationById(
      execution.authorizationId,
    );
  if (
    !authorization ||
    authorization.state !== ReviewRunAuthorizationState.Active
  )
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "lease_authorization_inactive",
    );
  await assertLeaseAuthorization(authority, authorization, d);
  if (
    !sameExecutionAuthority(execution, authorization) ||
    lease.executionId !== execution.executionId ||
    lease.authorizationId !== authorization.authorizationId ||
    lease.mutationEpoch !== authorization.mutationEpoch ||
    lease.reviewRevisionHash !== authorization.reviewRevisionHash ||
    execution.producerReleaseId !== authorization.producerReleaseId ||
    lease.producerReleaseId !== authorization.producerReleaseId ||
    execution.protocolLimitsProfileId !==
      authorization.protocolLimitsProfileId ||
    execution.sourceRunId !== authorization.sourceRunId ||
    execution.sourceRunAttempt !== authorization.sourceRunAttempt ||
    execution.mutationEpoch !== authorization.mutationEpoch ||
    execution.revision.reviewRevisionHash !== authorization.reviewRevisionHash
  )
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "lease_authorization_mismatch",
    );
  const hardDeadline = minDate(
    authorization.expiresAt,
    authorization.maxExpiresAt,
    execution.executionDeadlineAt,
  );
  if (
    lease.state !== ReviewInvocationLeaseState.Active ||
    lease.expiresAt <= d.now() ||
    hardDeadline <= d.now() ||
    authorization.expiresAt > authorization.maxExpiresAt ||
    lease.expiresAt > hardDeadline ||
    lease.resultReportUntil > hardDeadline
  )
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "lease_authorization_deadline_invalid",
    );
  return hardDeadline;
}

export async function releaseLease(
  request: ReviewInvocationLeaseReleaseRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewInvocationLeaseRelease,
    request,
    d.digest,
  );
  const now = d.now();
  const authority = await verifyLease(request.leaseCapability, now, d);
  requireLeaseRequest(authority, request.leaseId, request.ownerIdHash);
  requireLeaseOwnership(authority, now);
  await requireLease(authority, d.executionQueries, false, now);
  const result = await d.executions.invocationLeases.release({
    leaseId: request.leaseId,
    ownerIdHash: request.ownerIdHash,
    leaseCapabilityId: authority.capabilityId,
    fencingToken: decimal(request.fencingToken),
    now,
  });
  return {
    statusCode: 200 as const,
    result: leaseTransitionResult(result.status, result.lease),
  };
}
