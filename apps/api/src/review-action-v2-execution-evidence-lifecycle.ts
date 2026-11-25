import {
  persistedReviewExecutionRestore,
  loadAcceptedReviewInvocationManifests,
} from "./review-execution-publication-restore.js";
import {
  assertLifecycleVerificationWorkSlots,
  assertLifecycleVerificationAssignmentManifest,
} from "./review-lifecycle-verification.js";
import {
  ReviewExecutionFinalizeStatus,
  ReviewWorkSlotState,
  ReviewWorkSlotTerminalReason as DomainWorkSlotTerminalReason,
  StartReviewExecutionStatus,
  type ReviewExecutionQueryPort,
  type ReviewExecutionSnapshot,
} from "@reviewrouter/features-review-executions";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  ReviewExecutionRestoreResultStatus,
  ReviewWorkSlotTerminalReason,
  ReviewWorkSlotTerminalState,
  type ReviewExecutionFinalizeRequest,
  type ReviewExecutionRestoreRequest,
  type ReviewExecutionStartRequest,
  type ReviewExecutionSupersedeRequest,
  type ReviewExecutionWorkSlotTerminalizeRequest,
} from "@reviewrouter/protocol-review-action-v2";
import {
  mutationResult,
  mapFinalize,
  mapStart,
} from "./review-action-v2-execution-result-mappers.js";
import {
  assertPrDescriptionArtifact,
  parseGeneratedPrDescription,
  assertPrDescriptionWorkSlots,
} from "./review-pr-description.js";
import { type ReviewActionV2ExecutionHandlerDependencies } from "./review-action-v2-execution-evidence-dependencies.js";
import {
  requireAuthorization,
  toExecutionScope,
  sameExecutionAuthority,
  assertBodyHash,
  executionLimits,
  requireExecution,
  toExecutionRevision,
  requireCurrentExecutionRevision,
  requireProtocolLimits,
} from "./review-action-v2-execution-evidence-authority.js";
import {
  requireEqual,
  parseWorkSlots,
  parseCanonicalJson,
  add,
  failure,
  decimal,
  record,
} from "./review-action-v2-execution-evidence-validation.js";

// Execution restoration, admission, terminal decisions and finalization orchestration.

export async function restoreExecution(
  request: ReviewExecutionRestoreRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  requireEqual(
    request.authorizationId,
    authorization.authorizationId,
    "authorization_scope_mismatch",
  );
  requireEqual(
    request.reviewRevisionHash,
    authorization.reviewRevisionHash,
    "revision_scope_mismatch",
  );
  const stream = await d.executionQueries.findStream(
    toExecutionScope(authorization),
  );
  const ids = [stream?.activeExecutionId, stream?.preparedExecutionId].filter(
    (id): id is string => id !== null && id !== undefined,
  );
  for (const id of ids) {
    const snapshot = await d.executionQueries.findExecution(id);
    if (
      snapshot &&
      sameExecutionAuthority(snapshot.execution, authorization) &&
      snapshot.execution.revision.reviewRevisionHash ===
        request.reviewRevisionHash
    ) {
      return {
        statusCode: 200 as const,
        result: await restoreResult(
          snapshot,
          authorization,
          d.executionQueries,
        ),
      };
    }
  }
  return {
    statusCode: 200 as const,
    result: { status: ReviewExecutionRestoreResultStatus.Missing },
  };
}

export async function startExecution(
  request: ReviewExecutionStartRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionStart,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  requireEqual(
    request.authorizationId,
    authorization.authorizationId,
    "authorization_scope_mismatch",
  );
  requireEqual(
    request.reviewRevisionHash,
    authorization.reviewRevisionHash,
    "revision_scope_mismatch",
  );
  requireEqual(
    request.sourceRunId,
    authorization.sourceRunId,
    "source_run_mismatch",
  );
  requireEqual(
    request.sourceRunAttempt,
    authorization.sourceRunAttempt,
    "source_run_attempt_mismatch",
  );
  await executionLimits(authorization, d);
  const workSlots = parseWorkSlots(request.workSlotsCanonicalJson);
  assertPrDescriptionWorkSlots(authorization, workSlots);
  assertLifecycleVerificationWorkSlots(authorization, workSlots);
  assertLifecycleVerificationAssignmentManifest(
    authorization,
    workSlots,
    request.assignmentManifestCanonicalJson
      ? parseCanonicalJson(
          request.assignmentManifestCanonicalJson,
          "assignment_manifest_invalid",
        )
      : null,
  );
  const now = d.now();
  const outcome = await d.executions.startReviewExecution.execute({
    scope: toExecutionScope(authorization),
    executionId: request.executionId,
    authorizationId: authorization.authorizationId,
    compatibilityKey: request.compatibilityKey,
    planHash: request.planHash,
    assignmentManifestCanonicalJson: request.assignmentManifestCanonicalJson,
    assignmentManifestHash: request.assignmentManifestHash,
    workSlots,
    sourceRunId: request.sourceRunId,
    sourceRunAttempt: request.sourceRunAttempt,
    admissionDeadlineAt: add(now, d.timing.admissionDurationMs),
    executionDeadlineAt: add(now, d.timing.executionDurationMs),
    retainUntil: add(now, d.timing.retentionDurationMs),
  });
  if (
    outcome.status === StartReviewExecutionStatus.AssignmentManifestRejected
  ) {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      outcome.rejectionReason ?? "assignment_manifest_invalid",
    );
  }
  return {
    statusCode:
      outcome.status === StartReviewExecutionStatus.Admitted
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapStart(outcome.status),
      ...(outcome.snapshot
        ? await executionResult(
            outcome.snapshot,
            authorization,
            d.executionQueries,
          )
        : {}),
    },
  };
}

export async function supersedeExecution(
  request: ReviewExecutionSupersedeRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionSupersede,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  requireEqual(
    request.targetRevisionHash,
    authorization.reviewRevisionHash,
    "target_revision_mismatch",
  );
  const snapshot = await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );
  const result = await d.executions.executionLifecycle.supersede({
    scope: toExecutionScope(authorization),
    executionId: request.executionId,
    expectedStreamVersion: decimal(request.expectedStreamVersion),
    observedCurrentRevision: toExecutionRevision(authorization),
    now: d.now(),
  });
  return {
    statusCode: 200 as const,
    result: mutationResult(
      result.status,
      request.executionId,
      result.snapshot ?? snapshot,
    ),
  };
}

export async function terminalizeWorkSlot(
  request: ReviewExecutionWorkSlotTerminalizeRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionWorkSlotTerminalize,
    request,
    d.digest,
  );
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  requireEqual(
    request.reviewRevisionHash,
    authorization.reviewRevisionHash,
    "revision_scope_mismatch",
  );
  const snapshot = await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );
  const result = await d.executions.executionLifecycle.terminalizeWorkSlot({
    scope: toExecutionScope(authorization),
    executionId: request.executionId,
    generation: decimal(request.generation),
    reviewRevisionHash: request.reviewRevisionHash,
    workSlotId: request.workSlotId,
    terminalState: executionTerminalState(request.terminalState),
    reasonCode: executionTerminalReason(request.reasonCode),
    now: d.now(),
  });
  return {
    statusCode: 200 as const,
    result: {
      ...mutationResult(
        result.status,
        request.executionId,
        result.snapshot ?? snapshot,
      ),
      workSlotId: request.workSlotId,
    },
  };
}

function executionTerminalState(
  state: ReviewWorkSlotTerminalState,
): ReviewWorkSlotState.Exhausted | ReviewWorkSlotState.Cancelled {
  switch (state) {
    case ReviewWorkSlotTerminalState.Exhausted:
      return ReviewWorkSlotState.Exhausted;
    case ReviewWorkSlotTerminalState.Cancelled:
      return ReviewWorkSlotState.Cancelled;
  }
}

function executionTerminalReason(
  reason: ReviewWorkSlotTerminalReason,
): DomainWorkSlotTerminalReason {
  switch (reason) {
    case ReviewWorkSlotTerminalReason.AttemptBudgetExhausted:
      return DomainWorkSlotTerminalReason.AttemptBudgetExhausted;
    case ReviewWorkSlotTerminalReason.DeadlineReached:
      return DomainWorkSlotTerminalReason.DeadlineReached;
  }
}

export async function finalizeExecution(
  request: ReviewExecutionFinalizeRequest,
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewExecutionFinalize,
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
  await d.contextReplay.assertCurrentPolicy({ authorization, snapshot });
  const projection = parseCanonicalJson(
    request.projectionEnvelopeCanonicalJson,
    "projection_envelope_invalid",
  );
  requireEqual(
    await d.digest.digestUtf8(request.projectionEnvelopeCanonicalJson),
    request.projectionHash,
    "projection_hash_mismatch",
  );
  await assertPrDescriptionArtifact({
    authorization,
    execution: snapshot.execution,
    leases: d.executionQueries,
    projection,
  });
  const publicationRuntime = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  if (
    publicationRuntime?.lifecycleVerificationCapability ||
    publicationRuntime?.modelDispatchCapability
  ) {
    const root = record(projection, "projection_envelope_invalid");
    const publishing = record(root.publishing, "projection_publishing_invalid");
    if (publishing.prDescription !== undefined) {
      const provenance = parseGeneratedPrDescription(
        publishing.prDescription,
      ).generationProvenance;
      const lease = await d.executionQueries.findLease(provenance.leaseId);
      if (
        !lease?.preparedManifestKey ||
        (publicationRuntime.modelDispatchCapability
          ? !d.verifyModelDispatchEvidence
          : !d.verifyCompanionDispatchEvidence)
      )
        throw failure(
          422,
          ReviewActionV2ProtocolErrorCode.InvariantViolation,
          "pr_description_dispatch_proof_unavailable",
        );
      const source = {
        authorization,
        role: "pr_description" as const,
        executionId: snapshot.execution.executionId,
        workSlotId: lease.workSlotId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        preparedManifestKey: lease.preparedManifestKey,
        providerRequestEnvelopeHash: provenance.providerRequestEnvelopeHash,
      };
      if (publicationRuntime.modelDispatchCapability)
        await d.verifyModelDispatchEvidence!({
          ...source,
          actualModel: provenance.actualModel,
        });
      else await d.verifyCompanionDispatchEvidence!(source);
    }
  }
  const now = d.now();
  const protocolLimits = await requireProtocolLimits(authorization, d);
  const limits = await executionLimits(authorization, d);
  const facts = await d.finalizationFacts.resolve({
    authorization,
    execution: snapshot.execution,
    observationRefs: snapshot.observationRefs,
    artifactId: request.artifactId,
    projectionEnvelopeVersion: request.projectionEnvelopeVersion,
    projectionEnvelope: projection,
    projectionCanonicalJson: request.projectionEnvelopeCanonicalJson,
    projectionHash: request.projectionHash,
    lifecycleStateHash: request.lifecycleStateHash,
    commandLedgerWatermark: decimal(request.commandLedgerWatermark),
    allowPartial: request.allowPartial,
    limits,
    maxReconciliationDurationMs: protocolLimits.maxReconciliationDurationMs,
    now,
  });
  requireEqual(
    facts.expectedArtifactHash,
    request.artifactHash,
    "artifact_hash_mismatch",
  );
  const finalizationNow = d.now();
  if (authorization.expiresAt <= finalizationNow) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "authorization_inactive",
    );
  }
  if (facts.publicationNotAfter <= finalizationNow) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "publication_permit_expired",
    );
  }
  const result = await d.executions.finalizeReviewExecution.execute({
    scope: executionScope,
    executionId: request.executionId,
    expectedStreamVersion: decimal(request.expectedStreamVersion),
    expectedExecutionVersion: decimal(request.expectedExecutionVersion),
    artifactId: request.artifactId,
    artifactHash: request.artifactHash,
    projectionEnvelopeVersion: request.projectionEnvelopeVersion,
    projectionEnvelopeJson: request.projectionEnvelopeCanonicalJson,
    projectionHash: request.projectionHash,
    byteCount: facts.byteCount,
    findingCount: facts.findingCount,
    lifecycleStateHash: request.lifecycleStateHash,
    commandLedgerWatermark: decimal(request.commandLedgerWatermark),
    projectionPolicyVersion: facts.projectionPolicyVersion,
    publicationSafetyDecisionHash: facts.publicationSafetyDecisionHash,
    publicationNotAfter: facts.publicationNotAfter,
    permitEpoch: authorization.mutationEpoch,
    allowPartial: request.allowPartial,
    ...(facts.coverageExceptions
      ? { coverageExceptions: facts.coverageExceptions }
      : {}),
    limits,
    now: finalizationNow,
    retainUntil: facts.retainUntil,
  });
  if (result.artifact) {
    await requireCurrentExecutionRevision(
      { scope: executionScope, executionId: request.executionId },
      d,
    );
  }
  const publicationNow = d.now();
  if (
    result.artifact &&
    result.artifact.publicationPermit.publicationNotAfter <= publicationNow
  ) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "publication_permit_expired",
    );
  }
  const permit = result.artifact
    ? await d.capabilities.issuePublicationPermit(
        result.artifact.publicationPermit,
        publicationNow,
      )
    : null;
  return {
    statusCode:
      result.status === ReviewExecutionFinalizeStatus.Finalized
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapFinalize(result.status),
      executionId: request.executionId,
      artifactId: result.artifact?.artifactId ?? null,
      artifactHash: result.artifact ? request.artifactHash : null,
      publicationPermit: permit,
    },
  };
}

async function executionResult(
  snapshot: ReviewExecutionSnapshot,
  authorization: ReviewRunAuthorization,
  queries: Pick<ReviewExecutionQueryPort, "findLease">,
) {
  return {
    executionId: snapshot.execution.executionId,
    generation: snapshot.execution.generation.toString(10),
    streamVersion: snapshot.stream.version.toString(10),
    executionVersion: snapshot.execution.version.toString(10),
    executionCanonicalJson: await canonicalExecution(
      snapshot,
      authorization,
      queries,
    ),
  };
}

async function restoreResult(
  snapshot: ReviewExecutionSnapshot,
  authorization: ReviewRunAuthorization,
  queries: Pick<ReviewExecutionQueryPort, "findLease">,
) {
  return {
    status: ReviewExecutionRestoreResultStatus.Found,
    executionId: snapshot.execution.executionId,
    generation: snapshot.execution.generation.toString(10),
    streamVersion: snapshot.stream.version.toString(10),
    executionState: snapshot.execution.state,
    executionCanonicalJson: await canonicalExecution(
      snapshot,
      authorization,
      queries,
    ),
  };
}

async function canonicalExecution(
  snapshot: ReviewExecutionSnapshot,
  authorization: ReviewRunAuthorization,
  queries: Pick<ReviewExecutionQueryPort, "findLease">,
) {
  const e = snapshot.execution;
  const persistedPlan =
    parseReviewRunRuntimeSnapshot(authorization.runtimeSnapshotCanonicalJson)
      ?.lifecycleVerificationCapability ||
    (e.assignmentManifestCanonicalJson &&
      JSON.parse(e.assignmentManifestCanonicalJson).manifestVersion === 2)
      ? persistedReviewExecutionRestore(
          snapshot,
          await loadAcceptedReviewInvocationManifests(snapshot, queries),
        )
      : undefined;
  return canonicalJson({
    ...(persistedPlan ? { persistedPlan } : {}),
    executionId: e.executionId,
    version: e.version.toString(10),
    generation: e.generation.toString(10),
    state: e.state,
    authorizationId: e.authorizationId,
    reviewRevisionHash: e.revision.reviewRevisionHash,
    planHash: e.planHash,
    workSlots: e.workSlots.map((s) => ({
      workSlotId: s.workSlotId,
      state: s.state,
      required: s.required,
      providerVoteIdentityHash: s.providerVoteIdentityHash,
      activeLeaseId: s.activeLeaseId,
      acceptedObservationRefId: s.acceptedObservationRefId,
    })),
  });
}
