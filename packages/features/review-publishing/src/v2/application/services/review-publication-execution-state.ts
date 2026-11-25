import {
  BeginReviewPublicationOperationStatus,
  type ReviewPublicationAttemptView,
  type ReviewPublicationGatewayObject,
} from "../ports/review-publication-ports";
import {
  ReviewPublicationAttemptState,
  assertIdentifier,
  ReviewPublicationOperationAttemptState,
  ReviewPublicationTerminalOutcome,
  hasEveryRequiredCanonicalReceipt,
  isOptionalPrDescriptionOperation,
  operationCapabilityFacts,
  publicationOperationsWithExternalEffectRisk,
  selectCanonicalExternalEffect,
  type ReviewPublicationClaimTerm,
  type ReviewPublicationExternalEffect,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
  type ReviewPublicationPermitIdentity,
} from "../../domain/review-publication-attempt";
import {
  ReviewV2PublicationExecutionStatus,
  ReviewV2PublicationFreshnessReadStatus,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
  type ReviewV2PublicationExecutorPolicy,
  type ReviewV2PublicationFreshnessRead,
  type ReviewV2PublicationFreshnessSnapshot,
} from "../ports/review-publication-execution-ports";

const hashPattern = /^[a-f0-9]{64}$/;

export type FreshnessAssessment =
  | {
      readonly status: "current";
      readonly snapshot: ReviewV2PublicationFreshnessSnapshot;
    }
  | {
      readonly status: "changed";
      readonly snapshot: ReviewV2PublicationFreshnessSnapshot | null;
      readonly safeReason: string;
    }
  | {
      readonly status: "unavailable";
      readonly safeReason: string;
    };

export function reconstructLatestOperationCapability(
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
): ReviewPublicationOperationCapabilityFacts | null {
  const latest = view.operationAttempts
    .filter(
      (attempt) =>
        attempt.publicationOperationId === operation.publicationOperationId,
    )
    .sort(
      (left, right) =>
        right.startedAt.getTime() - left.startedAt.getTime() ||
        right.operationAttemptId.localeCompare(left.operationAttemptId),
    )[0];
  if (!latest) return null;
  const targetExternalObjectId = operation.dependsOnOperationId
    ? (view.receipts.find(
        (receipt) =>
          receipt.publicationOperationId === operation.dependsOnOperationId,
      )?.canonicalExternalObjectId ?? null)
    : null;
  return operationCapabilityFacts({
    attempt: view.attempt,
    operation,
    operationAttempt: latest,
    targetExternalObjectId,
  });
}

export function latestProvenNoEffectAttempt(
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
) {
  return view.operationAttempts
    .filter(
      (attempt) =>
        attempt.publicationOperationId === operation.publicationOperationId &&
        attempt.state === ReviewPublicationOperationAttemptState.NoEffectProven,
    )
    .sort(
      (left, right) =>
        right.startedAt.getTime() - left.startedAt.getTime() ||
        right.operationAttemptId.localeCompare(left.operationAttemptId),
    )[0];
}

export function noEffectSafeCode(reason: string | null): string {
  const prefix = "definitely_no_effect:";
  return reason?.startsWith(prefix) && reason.length > prefix.length
    ? reason.slice(prefix.length)
    : "provider_rejected_without_effect";
}

export function capabilityBelongsToClaim(
  capability: ReviewPublicationOperationCapabilityFacts,
  claim: ReviewPublicationClaimTerm,
): boolean {
  return (
    capability.claimId === claim.claimId &&
    capability.claimFencingToken === claim.fencingToken
  );
}

export function canonicalVisibleEffect(
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
  objects: readonly ReviewPublicationGatewayObject[],
): ReviewPublicationExternalEffect | null {
  const visibleIds = new Set(objects.map((object) => object.externalObjectId));
  return selectCanonicalExternalEffect(
    view.effects.filter(
      (effect) =>
        effect.publicationOperationId === operation.publicationOperationId &&
        visibleIds.has(effect.externalObjectId),
    ),
  );
}

export function normalizeInventory(
  input: readonly ReviewPublicationGatewayObject[],
  operation: ReviewPublicationOperation,
): readonly ReviewPublicationGatewayObject[] {
  const byId = new Map<string, ReviewPublicationGatewayObject>();
  for (const object of input) {
    validateGatewayObject(object, operation);
    const existing = byId.get(object.externalObjectId);
    if (existing && !sameGatewayObject(existing, object)) {
      throw new Error("publication_marker_object_conflict");
    }
    byId.set(object.externalObjectId, object);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.observedAt.getTime() - right.observedAt.getTime() ||
      left.externalObjectId.localeCompare(right.externalObjectId),
  );
}

export function mergeGatewayObjects(
  ...groups: readonly (readonly ReviewPublicationGatewayObject[])[]
): readonly ReviewPublicationGatewayObject[] {
  const merged = new Map<string, ReviewPublicationGatewayObject>();
  for (const object of groups.flat()) {
    const existing = merged.get(object.externalObjectId);
    if (!existing || object.observedAt < existing.observedAt) {
      merged.set(object.externalObjectId, object);
    }
  }
  return [...merged.values()];
}

export function validateGatewayObject(
  object: ReviewPublicationGatewayObject,
  operation: ReviewPublicationOperation,
): void {
  assertIdentifier(
    object.externalObjectId,
    "publication_gateway_object_id_invalid",
  );
  if (
    object.markerHash !== operation.markerHash ||
    !hashPattern.test(object.bodyHash) ||
    !hashPattern.test(object.observedObjectHash)
  ) {
    throw new Error("publication_gateway_marker_identity_mismatch");
  }
  if (
    !(object.observedAt instanceof Date) ||
    !Number.isFinite(object.observedAt.getTime())
  ) {
    throw new Error("publication_gateway_observed_at_invalid");
  }
}

export function currentOperationObjects(
  objects: readonly ReviewPublicationGatewayObject[],
  operation: ReviewPublicationOperation,
): readonly ReviewPublicationGatewayObject[] {
  return objects.filter((object) =>
    isCurrentOperationObject(object, operation),
  );
}

export function hasCurrentOperationObject(
  objects: readonly ReviewPublicationGatewayObject[],
  operation: ReviewPublicationOperation,
): boolean {
  return objects.some((object) => isCurrentOperationObject(object, operation));
}

function isCurrentOperationObject(
  object: ReviewPublicationGatewayObject,
  operation: ReviewPublicationOperation,
): boolean {
  return object.bodyHash === operation.bodyHash;
}

function sameGatewayObject(
  left: ReviewPublicationGatewayObject,
  right: ReviewPublicationGatewayObject,
): boolean {
  return (
    left.effectKind === right.effectKind &&
    left.markerHash === right.markerHash &&
    left.bodyHash === right.bodyHash &&
    left.observedObjectHash === right.observedObjectHash &&
    left.observedAt.getTime() === right.observedAt.getTime()
  );
}

export function assessFreshness(
  read: ReviewV2PublicationFreshnessRead,
  permit: ReviewPublicationPermitIdentity,
): FreshnessAssessment {
  if (read.status === ReviewV2PublicationFreshnessReadStatus.Unavailable) {
    return { status: "unavailable", safeReason: read.safeReason };
  }
  if (read.status === ReviewV2PublicationFreshnessReadStatus.Missing) {
    return {
      status: "changed",
      snapshot: null,
      safeReason: read.safeReason,
    };
  }
  if (read.status !== ReviewV2PublicationFreshnessReadStatus.Available) {
    return {
      status: "unavailable",
      safeReason: "publication_freshness_unavailable",
    };
  }
  const snapshot = read.snapshot;
  if (
    snapshot.reviewedHeadSha !== permit.reviewedHeadSha ||
    snapshot.reviewRevisionHash !== permit.reviewRevisionHash ||
    snapshot.lifecycleStateHash !== permit.lifecycleStateHash ||
    snapshot.commandLedgerWatermark !== permit.commandLedgerWatermark ||
    snapshot.authorizationId !== permit.authorizationId ||
    snapshot.producerReleaseId !== permit.producerReleaseId ||
    snapshot.permitEpoch !== permit.permitEpoch ||
    snapshot.publicationSafetyDecisionHash !==
      permit.publicationSafetyDecisionHash ||
    snapshot.publicationNotAfter.getTime() !==
      permit.publicationNotAfter.getTime()
  ) {
    return {
      status: "changed",
      snapshot,
      safeReason: "publication_live_facts_changed",
    };
  }
  return { status: "current", snapshot };
}

export function sameFreshness(
  left: ReviewV2PublicationFreshnessSnapshot,
  right: ReviewV2PublicationFreshnessSnapshot,
): boolean {
  return (
    left.reviewedHeadSha === right.reviewedHeadSha &&
    left.reviewRevisionHash === right.reviewRevisionHash &&
    left.lifecycleStateHash === right.lifecycleStateHash &&
    left.commandLedgerWatermark === right.commandLedgerWatermark &&
    left.baseSha === right.baseSha &&
    left.mergeBaseSha === right.mergeBaseSha &&
    left.authorizationId === right.authorizationId &&
    left.producerReleaseId === right.producerReleaseId &&
    left.permitEpoch === right.permitEpoch &&
    left.publicationSafetyDecisionHash ===
      right.publicationSafetyDecisionHash &&
    left.publicationNotAfter.getTime() === right.publicationNotAfter.getTime()
  );
}

export function inspectTerminal(
  view: ReviewPublicationAttemptView,
  operationId: string,
): ReviewV2PublicationExecutionResult | null {
  if (
    view.attempt.terminalOutcome ===
    ReviewPublicationTerminalOutcome.TerminalUnknown
  ) {
    return {
      status: ReviewV2PublicationExecutionStatus.TerminalUnknown,
      safeReason: "publication_terminal_unknown_manual_review_required",
    };
  }
  if (
    view.attempt.terminalOutcome !== null &&
    view.attempt.terminalOutcome !== ReviewPublicationTerminalOutcome.Succeeded
  ) {
    return {
      status: ReviewV2PublicationExecutionStatus.Terminalized,
      safeReason: `publication_${view.attempt.terminalOutcome}`,
      terminalOutcome: view.attempt.terminalOutcome,
    };
  }
  const receipt = view.receipts.find(
    (candidate) => candidate.publicationOperationId === operationId,
  );
  if (receipt) {
    return {
      status: ReviewV2PublicationExecutionStatus.AlreadyCompleted,
      safeReason: "publication_operation_already_completed",
      receiptStatus: receipt.status,
    };
  }
  if (view.attempt.state === ReviewPublicationAttemptState.Terminal) {
    const operation = view.attempt.operations.find(
      (row) => row.publicationOperationId === operationId,
    );
    if (
      operation &&
      isOptionalPrDescriptionOperation(operation) &&
      view.tombstones.some((row) => row.publicationOperationId === operationId)
    ) {
      return {
        status: ReviewV2PublicationExecutionStatus.Terminalized,
        safeReason: "optional_pr_description_closed",
        terminalOutcome: ReviewPublicationTerminalOutcome.Succeeded,
      };
    }
    return manual("publication_attempt_terminal_without_operation_receipt");
  }
  return null;
}

export function requireOperation(
  view: ReviewPublicationAttemptView,
  operationId: string,
): ReviewPublicationOperation {
  const operation = view.attempt.operations.find(
    (candidate) => candidate.publicationOperationId === operationId,
  );
  if (!operation) throw new Error("publication_operation_missing");
  return operation;
}

export function currentClaim(
  view: ReviewPublicationAttemptView,
  expected: ReviewPublicationClaimTerm,
): ReviewPublicationClaimTerm | null {
  const current = view.activeClaim;
  if (
    !current ||
    current.claimId !== expected.claimId ||
    current.ownerIdHash !== expected.ownerIdHash ||
    current.fencingToken !== expected.fencingToken
  ) {
    return null;
  }
  return current;
}

export function mayHaveExternalEffect(
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
): boolean {
  return externalEffectRiskOperations(view).some(
    (candidate) =>
      candidate.publicationOperationId === operation.publicationOperationId,
  );
}

export function reconciliationRiskOperations(
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
): readonly ReviewPublicationOperation[] {
  const risks = externalEffectRiskOperations(view);
  if (
    isOptionalPrDescriptionOperation(operation) &&
    hasEveryRequiredCanonicalReceipt({
      operations: view.attempt.operations,
      receipts: view.receipts,
    })
  ) {
    // Required canonical receipts are settled independently of optional body
    // reconciliation. Retain every optional risk, including unresolved siblings.
    return risks.filter((candidate) => !candidate.required);
  }
  return risks;
}

function externalEffectRiskOperations(
  view: ReviewPublicationAttemptView,
): readonly ReviewPublicationOperation[] {
  return publicationOperationsWithExternalEffectRisk({
    operations: view.attempt.operations,
    operationAttempts: view.operationAttempts,
    effects: view.effects,
    receipts: view.receipts,
  });
}

export function mapBeginFailure(
  status: Exclude<
    BeginReviewPublicationOperationStatus,
    | BeginReviewPublicationOperationStatus.Begun
    | BeginReviewPublicationOperationStatus.Restored
  >,
): ReviewV2PublicationExecutionResult {
  switch (status) {
    case BeginReviewPublicationOperationStatus.VersionConflict:
    case BeginReviewPublicationOperationStatus.StaleClaim:
    case BeginReviewPublicationOperationStatus.DependencyNotCompleted:
    case BeginReviewPublicationOperationStatus.OperationInFlight:
      return retryable(`publication_begin_${status}`);
    case BeginReviewPublicationOperationStatus.OperationCompleted:
      return {
        status: ReviewV2PublicationExecutionStatus.AlreadyCompleted,
        safeReason: "publication_operation_already_completed",
      };
    case BeginReviewPublicationOperationStatus.Missing:
    case BeginReviewPublicationOperationStatus.RequestConflict:
    case BeginReviewPublicationOperationStatus.Terminal:
      return manual(`publication_begin_${status}`);
  }
}

export function retryable(
  safeReason: string,
): ReviewV2PublicationExecutionResult {
  return { status: ReviewV2PublicationExecutionStatus.Retryable, safeReason };
}

export function busy(safeReason: string): ReviewV2PublicationExecutionResult {
  return { status: ReviewV2PublicationExecutionStatus.Busy, safeReason };
}

export function manual(safeReason: string): ReviewV2PublicationExecutionResult {
  return {
    status: ReviewV2PublicationExecutionStatus.ManualRequired,
    safeReason,
  };
}

export function assertPolicy(policy: ReviewV2PublicationExecutorPolicy): void {
  if (
    !Number.isSafeInteger(policy.claimDurationMs) ||
    policy.claimDurationMs <= 0
  ) {
    throw new Error("review_v2_publication_claim_duration_invalid");
  }
  if (
    !Number.isSafeInteger(policy.minimumMutationLeaseMs) ||
    policy.minimumMutationLeaseMs <= 0 ||
    policy.minimumMutationLeaseMs > policy.claimDurationMs
  ) {
    throw new Error("review_v2_publication_minimum_mutation_lease_invalid");
  }
  if (
    !Number.isSafeInteger(policy.maxMarkerPages) ||
    policy.maxMarkerPages <= 0 ||
    policy.maxMarkerPages > 1_000
  ) {
    throw new Error("review_v2_publication_marker_page_limit_invalid");
  }
}

export function assertCommand(
  command: ReviewV2PublicationExecutionCommand,
): void {
  assertIdentifier(
    command.publicationAttemptId,
    "publication_attempt_id_invalid",
  );
  assertIdentifier(
    command.publicationOperationId,
    "publication_operation_id_invalid",
  );
  if (!hashPattern.test(command.ownerIdHash)) {
    throw new Error("publication_owner_hash_invalid");
  }
}

export function safeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
  return normalized || fallback;
}
