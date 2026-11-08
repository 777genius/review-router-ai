import {
  ReviewPublicationReceiptStatus,
  planPublicationSiblingTerminalizations,
  type ReviewPublicationClaimTerm,
  type ReviewPublicationExternalEffect,
  type ReviewPublicationOperation,
} from "../../domain/review-publication-attempt";
import {
  type ReviewPublicationAttemptView,
  type TerminalizeUnknownReviewPublicationCommand,
} from "../ports/review-publication-ports";

/** Persisted v2 command identities retain their original bigint, Date and key ordering. */
export function buildClaimCommand(
  digestUtf8: (value: string) => string,
  input: {
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly ownerIdHash: string;
    readonly signingKeyId: string;
    readonly now: Date;
    readonly claimDurationMs: number;
  },
) {
  const retainUntilMs = input.view.attempt.retainUntil.getTime();
  const expiresAt = new Date(
    Math.min(input.now.getTime() + input.claimDurationMs, retainUntilMs),
  );
  if (expiresAt <= input.now) {
    throw new Error("publication_claim_retention_exhausted");
  }
  const reportUntil = new Date(
    Math.min(
      Math.max(expiresAt.getTime(), input.operation.reconcileUntil.getTime()),
      retainUntilMs,
    ),
  );
  const acquireRequestIdHash = digestUtf8(
    `rr.publication-claim.v2\0${input.view.attempt.publicationAttemptId}\0${input.view.attempt.version}\0${input.ownerIdHash}`,
  );
  const claimId = deterministicId(digestUtf8, "claim", acquireRequestIdHash);
  const claimCapabilityId = deterministicId(
    digestUtf8,
    "claim-capability",
    acquireRequestIdHash,
  );
  const body = {
    publicationAttemptId: input.view.attempt.publicationAttemptId,
    expectedAttemptVersion: input.view.attempt.version,
    claimId,
    ownerIdHash: input.ownerIdHash,
    acquireRequestIdHash,
    claimCapabilityId,
    capabilitySigningKeyId: input.signingKeyId,
    expiresAt,
    reportUntil,
    retainUntil: input.view.attempt.retainUntil,
  };
  return {
    ...body,
    requestHash: digestUtf8(canonicalPublicationExecutionCommandJson(body)),
  };
}

export function buildBeginCommand(
  digestUtf8: (value: string) => string,
  input: {
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly signingKeyId: string;
  },
) {
  const acquireRequestIdHash = digestUtf8(
    `rr.publication-operation-begin.v2\0${input.operation.publicationOperationId}\0${input.claim.claimId}\0${input.claim.fencingToken}`,
  );
  const operationAttemptId = deterministicId(
    digestUtf8,
    "operation-attempt",
    acquireRequestIdHash,
  );
  const body = {
    publicationAttemptId: input.view.attempt.publicationAttemptId,
    publicationOperationId: input.operation.publicationOperationId,
    expectedAttemptVersion: input.view.attempt.version,
    claimId: input.claim.claimId,
    claimFencingToken: input.claim.fencingToken,
    acquireRequestIdHash,
    operationAttemptId,
    operationCapabilityId: deterministicId(
      digestUtf8,
      "operation-capability",
      acquireRequestIdHash,
    ),
    capabilitySigningKeyId: input.signingKeyId,
    effectReportId: deterministicId(
      digestUtf8,
      "effect-report",
      acquireRequestIdHash,
    ),
    effectReportUntil: new Date(input.operation.reconcileUntil),
    retainUntil: input.view.attempt.retainUntil,
  };
  return {
    ...body,
    requestHash: digestUtf8(canonicalPublicationExecutionCommandJson(body)),
  };
}

export function buildCompletionCommand(
  digestUtf8: (value: string) => string,
  input: {
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly effect: ReviewPublicationExternalEffect;
  },
) {
  const completionRequestIdHash = digestUtf8(
    `rr.publication-complete.v2\0${input.operation.publicationOperationId}\0${input.claim.claimId}\0${input.effect.effectId}`,
  );
  const receiptId = deterministicId(
    digestUtf8,
    "receipt",
    completionRequestIdHash,
  );
  const receiptHash = digestUtf8(
    canonicalPublicationExecutionCommandJson({
      receiptId,
      publicationAttemptId: input.view.attempt.publicationAttemptId,
      publicationOperationId: input.operation.publicationOperationId,
      canonicalEffectId: input.effect.effectId,
      canonicalExternalObjectId: input.effect.externalObjectId,
      status: ReviewPublicationReceiptStatus.Succeeded,
    }),
  );
  const body = {
    publicationAttemptId: input.view.attempt.publicationAttemptId,
    publicationOperationId: input.operation.publicationOperationId,
    expectedAttemptVersion: input.view.attempt.version,
    claimId: input.claim.claimId,
    claimFencingToken: input.claim.fencingToken,
    completionRequestIdHash,
    receiptId,
    canonicalEffectId: input.effect.effectId,
    receiptHash,
  };
  return {
    ...body,
    requestHash: digestUtf8(canonicalPublicationExecutionCommandJson(body)),
  };
}

export function terminalizationSiblingTombstones(
  digestUtf8: (value: string) => string,
  view: ReviewPublicationAttemptView,
  operation: ReviewPublicationOperation,
  outcome: NonNullable<
    TerminalizeUnknownReviewPublicationCommand["finalOutcome"]
  >,
): TerminalizeUnknownReviewPublicationCommand["siblingTombstones"] {
  return planPublicationSiblingTerminalizations({
    publicationOperationId: operation.publicationOperationId,
    attemptOutcome: outcome,
    operations: view.attempt.operations,
    operationAttempts: view.operationAttempts,
    effects: view.effects,
    receipts: view.receipts,
  }).map((planned) => ({
    publicationOperationId: planned.publicationOperationId,
    tombstoneId: deterministicId(
      digestUtf8,
      "tombstone",
      `${view.attempt.publicationAttemptId}\0${planned.publicationOperationId}`,
    ),
    finalOutcome: planned.finalOutcome,
  }));
}

export function deterministicId(
  digestUtf8: (value: string) => string,
  kind: string,
  preimage: string,
): string {
  return `rr-${kind}-${digestUtf8(`rr.${kind}.v2\0${preimage}`)}`;
}

export function canonicalPublicationExecutionCommandJson(
  value: unknown,
): string {
  return JSON.stringify(normalizeCanonical(value));
}

function normalizeCanonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeCanonical(entry)]),
    );
  }
  return value;
}
