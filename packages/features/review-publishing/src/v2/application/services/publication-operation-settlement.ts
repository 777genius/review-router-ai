import {
  CompleteReviewPublicationOperationStatus,
  ProveReviewPublicationNoEffectStatus,
  RecordReviewExternalEffectStatus,
  TerminalizeUnknownReviewPublicationStatus,
  type ReviewPublicationAttemptView,
  type ReviewPublicationGatewayObject,
  type ReviewPublicationAttemptQueryPort,
} from "../ports/review-publication-ports";
import {
  ReviewPublicationExternalEffectKind,
  ReviewPublicationTerminalOutcome,
  type ReviewPublicationClaimTerm,
  type ReviewPublicationExternalEffect,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
} from "../../domain/review-publication-attempt";
import {
  ReviewV2PublicationExecutionStatus,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
  type ReviewV2PublicationApplicationPort,
  type ReviewV2PublicationClockPort,
} from "../ports/review-publication-execution-ports";
import {
  mayHaveExternalEffect,
  retryable,
  manual,
  safeIdentifier,
} from "./review-publication-execution-state";
import {
  buildCompletionCommand,
  terminalizationSiblingTombstones,
  deterministicId,
  canonicalPublicationExecutionCommandJson,
} from "./review-publication-execution-commands";

type PublicationOperationSettlementDependencies = {
  readonly attempts: ReviewPublicationAttemptQueryPort;
  readonly application: Pick<
    ReviewV2PublicationApplicationPort,
    | "recordEffect"
    | "proveNoEffect"
    | "completeOperation"
    | "terminalizeUnknown"
  >;
  readonly clock: ReviewV2PublicationClockPort;
  readonly digestUtf8: (value: string) => string;
};

/** Durable operation acknowledgements and terminal outcomes, without SCM access. */
export class PublicationOperationSettlement {
  constructor(
    private readonly dependencies: PublicationOperationSettlementDependencies,
  ) {}

  async terminalizeKnownAmbiguity(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly finalReason: string;
    readonly lastErrorCode: string;
  }): Promise<ReviewV2PublicationExecutionResult> {
    const view = await this.dependencies.attempts.findById(
      input.command.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_disappeared");
    return this.terminalizeOrRetry({ ...input, view });
  }

  async terminalizeKnownOutcome(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly finalOutcome:
      | ReviewPublicationTerminalOutcome.SupersededNoEffect
      | ReviewPublicationTerminalOutcome.FailedNoEffect
      | ReviewPublicationTerminalOutcome.StaleCompensated
      | ReviewPublicationTerminalOutcome.StaleVisible;
    readonly finalReason: string;
    readonly lastErrorCode: string;
    readonly noEffectCapability?: ReviewPublicationOperationCapabilityFacts;
  }): Promise<ReviewV2PublicationExecutionResult> {
    let view = await this.dependencies.attempts.findById(
      input.command.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_disappeared");
    if (
      (input.finalOutcome ===
        ReviewPublicationTerminalOutcome.SupersededNoEffect ||
        input.finalOutcome ===
          ReviewPublicationTerminalOutcome.FailedNoEffect) &&
      mayHaveExternalEffect(view, input.operation)
    ) {
      if (!input.noEffectCapability) return retryable(input.lastErrorCode);
      const noEffectReason = `definitely_no_effect:${safeIdentifier(
        input.lastErrorCode,
        "unknown_error",
      )}`;
      const noEffectProofId = deterministicId(
        this.dependencies.digestUtf8,
        "no-effect-proof",
        input.noEffectCapability.operationAttemptId,
      );
      let proof;
      try {
        proof = await this.dependencies.application.proveNoEffect({
          capability: input.noEffectCapability,
          noEffectProofId,
          noEffectReason,
        });
      } catch {
        return retryable("publication_no_effect_proof_ack_unknown");
      }
      if (
        proof.status !== ProveReviewPublicationNoEffectStatus.Proven &&
        proof.status !== ProveReviewPublicationNoEffectStatus.Restored
      ) {
        return retryable(`publication_no_effect_proof_${proof.status}`);
      }
      view = await this.dependencies.attempts.findById(
        input.command.publicationAttemptId,
      );
      if (!view) return manual("publication_attempt_disappeared");
    }
    let terminalized;
    try {
      terminalized = await this.dependencies.application.terminalizeUnknown({
        publicationAttemptId: input.command.publicationAttemptId,
        publicationOperationId: input.operation.publicationOperationId,
        expectedAttemptVersion: view.attempt.version,
        claimId: input.claim.claimId,
        claimFencingToken: input.claim.fencingToken,
        tombstoneId: deterministicId(
          this.dependencies.digestUtf8,
          "tombstone",
          `${input.command.publicationAttemptId}\0${input.operation.publicationOperationId}`,
        ),
        siblingTombstones: terminalizationSiblingTombstones(
          this.dependencies.digestUtf8,
          view,
          input.operation,
          input.finalOutcome,
        ),
        finalOutcome: input.finalOutcome,
        finalReason: safeIdentifier(
          input.finalReason,
          "publication_terminal_outcome",
        ),
        lastErrorCode: safeIdentifier(input.lastErrorCode, "unknown_error"),
        terminalizedBy: `worker:${input.command.ownerIdHash}`,
        retainUntil: view.attempt.retainUntil,
      });
    } catch {
      return retryable("publication_terminal_outcome_ack_unknown");
    }
    switch (terminalized.status) {
      case TerminalizeUnknownReviewPublicationStatus.Terminalized:
      case TerminalizeUnknownReviewPublicationStatus.Restored:
        return {
          status: ReviewV2PublicationExecutionStatus.Terminalized,
          safeReason: input.finalReason,
          terminalOutcome:
            terminalized.attempt.terminalOutcome ?? input.finalOutcome,
        };
      case TerminalizeUnknownReviewPublicationStatus.VersionConflict:
      case TerminalizeUnknownReviewPublicationStatus.StaleClaim:
        return retryable(`publication_terminal_outcome_${terminalized.status}`);
      case TerminalizeUnknownReviewPublicationStatus.ExternalEffectRisk:
        // A rejected operation can coexist with published siblings. Preserve
        // those effects and use their canonical deadlines for the manual handoff.
        return this.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: input.claim,
          finalReason: "attempt_effect_risk_requires_reconciliation",
          lastErrorCode: input.lastErrorCode,
        });
      case TerminalizeUnknownReviewPublicationStatus.Conflict:
        return this.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: input.claim,
          finalReason: "attempt_effect_risk_requires_reconciliation",
          lastErrorCode: input.lastErrorCode,
        });
      case TerminalizeUnknownReviewPublicationStatus.Missing:
      case TerminalizeUnknownReviewPublicationStatus.TooEarly:
        return manual(`publication_terminal_outcome_${terminalized.status}`);
    }
  }

  async terminalizeUnclaimedNoEffect(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly finalReason: string;
    readonly lastErrorCode: string;
  }): Promise<ReviewV2PublicationExecutionResult> {
    let terminalized;
    try {
      terminalized = await this.dependencies.application.terminalizeUnknown({
        publicationAttemptId: input.command.publicationAttemptId,
        publicationOperationId: input.operation.publicationOperationId,
        expectedAttemptVersion: input.view.attempt.version,
        claimId: null,
        claimFencingToken: null,
        tombstoneId: deterministicId(
          this.dependencies.digestUtf8,
          "tombstone",
          `${input.command.publicationAttemptId}\0${input.operation.publicationOperationId}`,
        ),
        siblingTombstones: terminalizationSiblingTombstones(
          this.dependencies.digestUtf8,
          input.view,
          input.operation,
          ReviewPublicationTerminalOutcome.SupersededNoEffect,
        ),
        finalOutcome: ReviewPublicationTerminalOutcome.SupersededNoEffect,
        finalReason: input.finalReason,
        lastErrorCode: input.lastErrorCode,
        terminalizedBy: `worker:${input.command.ownerIdHash}`,
        retainUntil: input.view.attempt.retainUntil,
      });
    } catch {
      return manual("publication_unclaimed_terminalization_unavailable");
    }
    switch (terminalized.status) {
      case TerminalizeUnknownReviewPublicationStatus.Terminalized:
      case TerminalizeUnknownReviewPublicationStatus.Restored:
        return {
          status: ReviewV2PublicationExecutionStatus.Terminalized,
          safeReason: input.finalReason,
          terminalOutcome:
            terminalized.attempt.terminalOutcome ??
            ReviewPublicationTerminalOutcome.SupersededNoEffect,
        };
      case TerminalizeUnknownReviewPublicationStatus.VersionConflict:
      case TerminalizeUnknownReviewPublicationStatus.StaleClaim:
      case TerminalizeUnknownReviewPublicationStatus.ExternalEffectRisk:
        return retryable(
          `publication_unclaimed_terminalization_${terminalized.status}`,
        );
      case TerminalizeUnknownReviewPublicationStatus.Missing:
      case TerminalizeUnknownReviewPublicationStatus.TooEarly:
      case TerminalizeUnknownReviewPublicationStatus.Conflict:
        return manual(
          `publication_unclaimed_terminalization_${terminalized.status}`,
        );
    }
  }

  async terminalizeOrRetry(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly finalReason: string;
    readonly lastErrorCode: string;
  }): Promise<ReviewV2PublicationExecutionResult> {
    if (this.dependencies.clock.now() < input.operation.reconcileUntil) {
      return retryable(input.lastErrorCode);
    }
    let terminalized;
    try {
      terminalized = await this.dependencies.application.terminalizeUnknown({
        publicationAttemptId: input.command.publicationAttemptId,
        publicationOperationId: input.operation.publicationOperationId,
        expectedAttemptVersion: input.view.attempt.version,
        claimId: input.claim.claimId,
        claimFencingToken: input.claim.fencingToken,
        tombstoneId: deterministicId(
          this.dependencies.digestUtf8,
          "tombstone",
          `${input.command.publicationAttemptId}\0${input.operation.publicationOperationId}`,
        ),
        siblingTombstones: terminalizationSiblingTombstones(
          this.dependencies.digestUtf8,
          input.view,
          input.operation,
          ReviewPublicationTerminalOutcome.TerminalUnknown,
        ),
        finalReason: safeIdentifier(
          input.finalReason,
          "publication_outcome_unknown",
        ),
        lastErrorCode: safeIdentifier(input.lastErrorCode, "unknown_error"),
        terminalizedBy: `worker:${input.command.ownerIdHash}`,
        retainUntil: input.view.attempt.retainUntil,
      });
    } catch {
      return retryable("publication_terminalize_ack_unknown");
    }
    switch (terminalized.status) {
      case TerminalizeUnknownReviewPublicationStatus.Terminalized:
      case TerminalizeUnknownReviewPublicationStatus.Restored:
        if (
          terminalized.attempt.terminalOutcome ===
          ReviewPublicationTerminalOutcome.Succeeded
        ) {
          return {
            status: ReviewV2PublicationExecutionStatus.Terminalized,
            safeReason: "optional_pr_description_closed",
            terminalOutcome: ReviewPublicationTerminalOutcome.Succeeded,
          };
        }
        return {
          status: ReviewV2PublicationExecutionStatus.TerminalUnknown,
          safeReason: "publication_terminal_unknown_manual_review_required",
        };
      case TerminalizeUnknownReviewPublicationStatus.TooEarly:
      case TerminalizeUnknownReviewPublicationStatus.VersionConflict:
      case TerminalizeUnknownReviewPublicationStatus.StaleClaim:
      case TerminalizeUnknownReviewPublicationStatus.ExternalEffectRisk:
        return retryable(`publication_terminalize_${terminalized.status}`);
      case TerminalizeUnknownReviewPublicationStatus.Missing:
      case TerminalizeUnknownReviewPublicationStatus.Conflict:
        return manual(`publication_terminalize_${terminalized.status}`);
    }
  }

  async recordOrRestoreEffect(input: {
    readonly operation: ReviewPublicationOperation;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
    readonly object: ReviewPublicationGatewayObject;
    readonly effectKind: ReviewPublicationExternalEffectKind;
  }): Promise<ReviewPublicationExternalEffect | null> {
    const view = await this.dependencies.attempts.findById(
      input.operation.publicationAttemptId,
    );
    const existing = view?.effects.find(
      (effect) =>
        effect.publicationOperationId ===
          input.operation.publicationOperationId &&
        effect.externalObjectId === input.object.externalObjectId,
    );
    if (existing) return existing;
    const effectId = deterministicId(
      this.dependencies.digestUtf8,
      "effect",
      `${input.capability.operationAttemptId}\0${input.capability.effectReportId}\0${input.object.externalObjectId}`,
    );
    const reportRequestHash = this.dependencies.digestUtf8(
      canonicalPublicationExecutionCommandJson({
        effectId,
        capabilityId: input.capability.capabilityId,
        effectReportId: input.capability.effectReportId,
        externalObjectId: input.object.externalObjectId,
        observedObjectHash: input.object.observedObjectHash,
        effectKind: input.effectKind,
      }),
    );
    let recorded;
    try {
      recorded = await this.dependencies.application.recordEffect({
        capability: input.capability,
        effectId,
        reportRequestHash,
        externalObjectId: input.object.externalObjectId,
        observedObjectHash: input.object.observedObjectHash,
        effectKind: input.effectKind,
      });
    } catch {
      recorded = null;
    }
    if (
      recorded?.status === RecordReviewExternalEffectStatus.Recorded ||
      recorded?.status === RecordReviewExternalEffectStatus.Restored
    ) {
      return recorded.effect;
    }
    const afterConflict = await this.dependencies.attempts.findById(
      input.operation.publicationAttemptId,
    );
    return (
      afterConflict?.effects.find(
        (effect) =>
          effect.publicationOperationId ===
            input.operation.publicationOperationId &&
          effect.externalObjectId === input.object.externalObjectId,
      ) ?? null
    );
  }

  async completeCanonicalOperation(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly effect: ReviewPublicationExternalEffect;
  }): Promise<ReviewV2PublicationExecutionResult> {
    const view = await this.dependencies.attempts.findById(
      input.command.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_disappeared");
    const completion = buildCompletionCommand(this.dependencies.digestUtf8, {
      view,
      operation: input.operation,
      claim: input.claim,
      effect: input.effect,
    });
    let completed;
    try {
      completed =
        await this.dependencies.application.completeOperation(completion);
    } catch {
      return retryable("publication_completion_ack_unknown");
    }
    switch (completed.status) {
      case CompleteReviewPublicationOperationStatus.Completed:
      case CompleteReviewPublicationOperationStatus.Restored:
        return {
          status: ReviewV2PublicationExecutionStatus.Completed,
          safeReason: "publication_operation_completed",
          receiptStatus: completed.receipt.status,
        };
      case CompleteReviewPublicationOperationStatus.VersionConflict:
      case CompleteReviewPublicationOperationStatus.StaleClaim:
        return retryable(`publication_completion_${completed.status}`);
      case CompleteReviewPublicationOperationStatus.Terminal:
        return manual("publication_attempt_terminal_without_receipt");
      case CompleteReviewPublicationOperationStatus.Missing:
      case CompleteReviewPublicationOperationStatus.RequestConflict:
      case CompleteReviewPublicationOperationStatus.CanonicalEffectConflict:
        return manual(`publication_completion_${completed.status}`);
    }
  }
}
