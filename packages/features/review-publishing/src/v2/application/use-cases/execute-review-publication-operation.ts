import {
  BeginReviewPublicationOperationStatus,
  ClaimReviewPublicationStatus,
  type ReviewPublicationAttemptView,
  type ReviewPublicationGatewayObject,
} from "../ports/review-publication-ports";
import {
  ReviewPublicationAttemptState,
  assertIdentifier,
  ReviewPublicationExternalEffectKind,
  ReviewPublicationKind,
  ReviewPublicationTerminalOutcome,
  hasEveryRequiredCanonicalReceipt,
  isOptionalPrDescriptionOperation,
  type ReviewPublicationClaimTerm,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
} from "../../domain/review-publication-attempt";
import {
  ReviewV2PublicationEffectGateDecision,
  ReviewV2ScmCredentialPurpose,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
  type ReviewV2PublicationExecutorDependencies,
  type ReviewV2PublicationExecutorPolicy,
  type ReviewV2ScmGatewaySession,
} from "../ports/review-publication-execution-ports";
import {
  reconstructLatestOperationCapability,
  latestProvenNoEffectAttempt,
  noEffectSafeCode,
  capabilityBelongsToClaim,
  mergeGatewayObjects,
  validateGatewayObject,
  hasCurrentOperationObject,
  inspectTerminal,
  requireOperation,
  currentClaim,
  mayHaveExternalEffect,
  reconciliationRiskOperations,
  mapBeginFailure,
  retryable,
  busy,
  manual,
  assertPolicy,
  assertCommand,
} from "../services/review-publication-execution-state";
import {
  buildClaimCommand,
  buildBeginCommand,
} from "../services/review-publication-execution-commands";
import { PublicationExecutionAuthority } from "../services/publication-execution-authority";
import { PublicationOperationSettlement } from "../services/publication-operation-settlement";
import {
  ReconcileReviewPublicationOperation,
  closePublicationGatewaySession,
} from "./reconcile-review-publication-operation";

type AcquiredClaim = {
  readonly claim: ReviewPublicationClaimTerm;
};

export class ExecuteReviewV2PublicationOperation {
  private readonly settlement: PublicationOperationSettlement;
  private readonly authority: PublicationExecutionAuthority;
  private readonly reconciliation: ReconcileReviewPublicationOperation;

  constructor(
    private readonly dependencies: ReviewV2PublicationExecutorDependencies,
    private readonly policy: ReviewV2PublicationExecutorPolicy,
  ) {
    assertPolicy(policy);
    this.settlement = new PublicationOperationSettlement({
      attempts: dependencies.attempts,
      application: {
        recordEffect: (command) =>
          dependencies.application.recordEffect(command),
        proveNoEffect: (command) =>
          dependencies.application.proveNoEffect(command),
        completeOperation: (command) =>
          dependencies.application.completeOperation(command),
        terminalizeUnknown: (command) =>
          dependencies.application.terminalizeUnknown(command),
      },
      clock: dependencies.clock,
      digestUtf8: dependencies.digestUtf8,
    });
    this.authority = new PublicationExecutionAuthority(
      {
        freshness: dependencies.freshness,
        effectGate: dependencies.effectGate,
        renewClaim: (command) => dependencies.application.renewClaim(command),
      },
      {
        claimDurationMs: policy.claimDurationMs,
        minimumMutationLeaseMs: policy.minimumMutationLeaseMs,
      },
    );
    this.reconciliation = new ReconcileReviewPublicationOperation(
      {
        attempts: dependencies.attempts,
        freshness: dependencies.freshness,
        compensation: dependencies.compensation,
        operationCapabilities: dependencies.operationCapabilities,
        credentials: dependencies.credentials,
        clock: dependencies.clock,
      },
      this.authority,
      this.settlement,
      policy.maxMarkerPages,
    );
  }

  async execute(
    requestedCommand: ReviewV2PublicationExecutionCommand,
  ): Promise<ReviewV2PublicationExecutionResult> {
    assertCommand(requestedCommand);
    let view = await this.dependencies.attempts.findById(
      requestedCommand.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_missing");
    if (view.attempt.state === ReviewPublicationAttemptState.Terminal) {
      return (
        inspectTerminal(view, requestedCommand.publicationOperationId) ??
        manual("publication_attempt_terminal_without_operation_receipt")
      );
    }
    const requestedOperation = requireOperation(
      view,
      requestedCommand.publicationOperationId,
    );
    if (
      isOptionalPrDescriptionOperation(requestedOperation) &&
      !hasEveryRequiredCanonicalReceipt({
        operations: view.attempt.operations,
        receipts: view.receipts,
      })
    ) {
      return retryable("pr_description_awaiting_required_publication");
    }
    const riskOperations = reconciliationRiskOperations(
      view,
      requestedOperation,
    );
    const requestedOperationHasRisk = riskOperations.some(
      (candidate) =>
        candidate.publicationOperationId ===
        requestedOperation.publicationOperationId,
    );
    let operationSelectedForReconciliation: ReviewPublicationOperation | null =
      requestedOperationHasRisk ? requestedOperation : null;
    if (!requestedOperationHasRisk && riskOperations.length > 0) {
      const routingFreshness = await this.authority.readFreshness(
        requestedCommand.provider,
        view.attempt.permit,
      );
      if (routingFreshness.status === "changed") {
        operationSelectedForReconciliation = riskOperations[0] ?? null;
      }
    }
    const operationForExecution =
      operationSelectedForReconciliation ?? requestedOperation;
    const reconcilingAggregateSibling =
      operationForExecution.publicationOperationId !==
      requestedOperation.publicationOperationId;
    const command: ReviewV2PublicationExecutionCommand = {
      ...requestedCommand,
      publicationOperationId: operationForExecution.publicationOperationId,
    };
    if (!reconcilingAggregateSibling) {
      const initial = inspectTerminal(view, command.publicationOperationId);
      if (initial) return initial;
    }
    let operation = operationForExecution;
    const pendingNoEffectProof = latestProvenNoEffectAttempt(view, operation);
    const potentialEffect = mayHaveExternalEffect(view, operation);
    const claimResult = await this.acquireClaim({
      command,
      view,
      operation,
      reconciliationOnly: potentialEffect || pendingNoEffectProof !== undefined,
    });
    if ("result" in claimResult) return claimResult.result;
    let claim = claimResult.claim;

    view = await this.dependencies.attempts.findById(
      command.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_disappeared");
    if (!reconcilingAggregateSibling) {
      const afterClaim = inspectTerminal(view, command.publicationOperationId);
      if (afterClaim) return afterClaim;
    }
    operation = requireOperation(view, command.publicationOperationId);
    const persistedClaim = currentClaim(view, claim);
    if (!persistedClaim) {
      return retryable("publication_claim_changed_after_acquire");
    }
    claim = persistedClaim;

    const provenNoEffectAttempt = latestProvenNoEffectAttempt(view, operation);
    if (provenNoEffectAttempt) {
      return this.settlement.terminalizeKnownOutcome({
        command,
        operation,
        claim,
        finalOutcome: ReviewPublicationTerminalOutcome.FailedNoEffect,
        finalReason: "scm_mutation_rejected_no_effect",
        lastErrorCode: noEffectSafeCode(provenNoEffectAttempt.noEffectReason),
      });
    }

    const priorCapability = reconstructLatestOperationCapability(
      view,
      operation,
    );
    let resumedCapability: ReviewPublicationOperationCapabilityFacts | null =
      null;
    if (priorCapability) {
      const reconciled = await this.reconciliation.reconcileBeforeRetry({
        command,
        view,
        operation,
        claim,
        capability: priorCapability,
      });
      if (reconciled.settled) return reconciled.result;
      claim = reconciled.claim;
      resumedCapability = capabilityBelongsToClaim(reconciled.capability, claim)
        ? reconciled.capability
        : null;
      view = await this.dependencies.attempts.findById(
        command.publicationAttemptId,
      );
      if (!view) return manual("publication_attempt_disappeared");
      operation = requireOperation(view, command.publicationOperationId);
    }

    const beforeBegin = await this.authority.readFreshness(
      command.provider,
      view.attempt.permit,
    );
    if (beforeBegin.status !== "current") {
      if (potentialEffect) {
        return this.settlement.terminalizeOrRetry({
          command,
          view,
          operation,
          claim,
          finalReason: "freshness_changed_after_possible_effect",
          lastErrorCode: beforeBegin.safeReason,
        });
      }
      return beforeBegin.status === "unavailable"
        ? retryable(beforeBegin.safeReason)
        : this.settlement.terminalizeKnownOutcome({
            command,
            operation,
            claim,
            finalOutcome: ReviewPublicationTerminalOutcome.SupersededNoEffect,
            finalReason: "publication_live_facts_superseded",
            lastErrorCode: beforeBegin.safeReason,
          });
    }
    if (this.dependencies.clock.now() >= operation.reconcileUntil) {
      return potentialEffect
        ? this.settlement.terminalizeOrRetry({
            command,
            view,
            operation,
            claim,
            finalReason: "reconciliation_window_exhausted",
            lastErrorCode: "publication_retry_window_exhausted",
          })
        : this.settlement.terminalizeKnownOutcome({
            command,
            operation,
            claim,
            finalOutcome: ReviewPublicationTerminalOutcome.FailedNoEffect,
            finalReason: "publication_operation_window_exhausted",
            lastErrorCode: "publication_operation_window_exhausted",
          });
    }

    const signingKeyId =
      await this.dependencies.capabilityIdentity.activeSigningKeyId();
    assertIdentifier(signingKeyId, "publication_capability_key_invalid");
    let begun: {
      readonly attempt: ReviewPublicationAttemptView["attempt"];
      readonly operation: ReviewPublicationOperation;
      readonly capability: ReviewPublicationOperationCapabilityFacts;
    };
    if (resumedCapability) {
      begun = {
        attempt: view.attempt,
        operation,
        capability: resumedCapability,
      };
    } else {
      const beginCommand = buildBeginCommand(this.dependencies.digestUtf8, {
        view,
        operation,
        claim,
        signingKeyId,
      });
      let beginResult;
      try {
        beginResult =
          await this.dependencies.application.beginOperation(beginCommand);
      } catch {
        if (potentialEffect) {
          return this.settlement.terminalizeKnownAmbiguity({
            command,
            operation,
            claim,
            finalReason: "publication_begin_failed_after_possible_effect",
            lastErrorCode: "publication_begin_gate_rejected",
          });
        }
        return this.settlement.terminalizeKnownOutcome({
          command,
          operation,
          claim,
          finalOutcome: ReviewPublicationTerminalOutcome.SupersededNoEffect,
          finalReason: "publication_begin_gate_rejected",
          lastErrorCode: "publication_begin_gate_rejected",
        });
      }
      if (
        beginResult.status !== BeginReviewPublicationOperationStatus.Begun &&
        beginResult.status !== BeginReviewPublicationOperationStatus.Restored
      ) {
        return mapBeginFailure(beginResult.status);
      }
      begun = {
        attempt: beginResult.attempt,
        operation: beginResult.operation,
        capability: beginResult.capability,
      };
    }

    const capability = begun.capability;
    const credentialLease = await this.authority.renewForMutation(
      command,
      claim,
    );
    if ("result" in credentialLease) return credentialLease.result;
    claim = credentialLease.claim;
    const credentialFreshness = await this.authority.readFreshness(
      command.provider,
      begun.attempt.permit,
    );
    if (credentialFreshness.status !== "current") {
      if (potentialEffect) {
        return this.settlement.terminalizeKnownAmbiguity({
          command,
          operation: begun.operation,
          claim,
          finalReason: "credential_freshness_changed_after_possible_effect",
          lastErrorCode: credentialFreshness.safeReason,
        });
      }
      return credentialFreshness.status === "unavailable"
        ? retryable(credentialFreshness.safeReason)
        : this.settlement.terminalizeKnownOutcome({
            command,
            operation: begun.operation,
            claim,
            finalOutcome: ReviewPublicationTerminalOutcome.SupersededNoEffect,
            finalReason: "publication_live_facts_superseded",
            lastErrorCode: credentialFreshness.safeReason,
          });
    }
    let signedCapability;
    try {
      signedCapability = await this.dependencies.operationCapabilities.issue({
        permit: begun.attempt.permit,
        operation: begun.operation,
        capability,
        claim,
      });
    } catch {
      return retryable("publication_operation_capability_unavailable");
    }
    let mutationSession: ReviewV2ScmGatewaySession;
    try {
      mutationSession = await this.dependencies.credentials.acquire({
        provider: command.provider,
        purpose: ReviewV2ScmCredentialPurpose.Mutate,
        permit: begun.attempt.permit,
        operation: begun.operation,
        capability,
        claim,
        signedCapability,
      });
    } catch {
      return retryable("publication_mutation_credential_unavailable");
    }
    try {
      if (mutationSession.purpose !== ReviewV2ScmCredentialPurpose.Mutate) {
        return manual("publication_mutation_credential_scope_invalid");
      }
      let inventory: readonly ReviewPublicationGatewayObject[];
      try {
        inventory = await this.reconciliation.loadInventory(
          mutationSession.gateway,
          begun.operation,
        );
      } catch {
        return manual("publication_marker_inventory_invalid");
      }
      if (hasCurrentOperationObject(inventory, begun.operation)) {
        return this.reconciliation.settleInventory({
          command,
          operation: begun.operation,
          claim,
          capability,
          gateway: mutationSession.gateway,
          inventory,
          effectKind: ReviewPublicationExternalEffectKind.MarkerReconciled,
        });
      }

      if (
        potentialEffect &&
        (begun.operation.publicationKind === ReviewPublicationKind.PrDescription ||
          begun.operation.publicationKind === ReviewPublicationKind.ThreadReply)
      ) {
        return this.settlement.terminalizeKnownAmbiguity({
          command,
          operation: begun.operation,
          claim,
          finalReason: "pr_description_prior_write_unreconciled",
          lastErrorCode: "pr_description_write_outcome_unknown",
        });
      }

      const replacement =
        await this.reconciliation.removeStalePendingReviewBeforeMutation({
          command,
          operation: begun.operation,
          permit: begun.attempt.permit,
          claim,
          gateway: mutationSession.gateway,
          inventory,
          priorEffectMayExist: potentialEffect,
        });
      if ("result" in replacement) return replacement.result;
      claim = replacement.claim;
      inventory = replacement.inventory;
      const cleanupMayHaveExternalEffect =
        replacement.cleanupMayHaveExternalEffect;
      const priorEffectMayExist =
        potentialEffect || cleanupMayHaveExternalEffect;
      if (hasCurrentOperationObject(inventory, begun.operation)) {
        return this.reconciliation.settleInventory({
          command,
          operation: begun.operation,
          claim,
          capability,
          gateway: mutationSession.gateway,
          inventory,
          effectKind: ReviewPublicationExternalEffectKind.MarkerReconciled,
        });
      }
      if (
        begun.operation.publicationKind ===
          ReviewPublicationKind.PendingReviewCreate &&
        inventory.length > 0
      ) {
        return retryable("publication_pending_review_replacement_raced");
      }

      let applied: ReviewPublicationGatewayObject;
      const mutationLease = await this.authority.renewForMutation(
        command,
        claim,
      );
      if ("result" in mutationLease) return mutationLease.result;
      claim = mutationLease.claim;
      const immediatelyBeforeMutation = await this.authority.readFreshness(
        command.provider,
        begun.attempt.permit,
      );
      if (immediatelyBeforeMutation.status !== "current") {
        if (priorEffectMayExist) {
          return this.settlement.terminalizeKnownAmbiguity({
            command,
            operation: begun.operation,
            claim,
            finalReason: "pending_review_replacement_freshness_changed",
            lastErrorCode: immediatelyBeforeMutation.safeReason,
          });
        }
        return immediatelyBeforeMutation.status === "unavailable"
          ? retryable(immediatelyBeforeMutation.safeReason)
          : this.settlement.terminalizeKnownOutcome({
              command,
              operation: begun.operation,
              claim,
              finalOutcome: ReviewPublicationTerminalOutcome.SupersededNoEffect,
              finalReason: "publication_live_facts_superseded",
              lastErrorCode: immediatelyBeforeMutation.safeReason,
            });
      }
      const finalMutationLease = await this.authority.renewForMutation(
        command,
        claim,
      );
      if ("result" in finalMutationLease) return finalMutationLease.result;
      claim = finalMutationLease.claim;
      const effectDecision = await this.authority.authorizeEffect(
        command.provider,
        begun.attempt.permit,
        begun.operation,
      );
      if (
        effectDecision === ReviewV2PublicationEffectGateDecision.Unavailable
      ) {
        return retryable("publication_effect_gate_unavailable");
      }
      if (effectDecision === ReviewV2PublicationEffectGateDecision.Disabled) {
        if (priorEffectMayExist) {
          return this.settlement.terminalizeKnownAmbiguity({
            command,
            operation: begun.operation,
            claim,
            finalReason: "pending_review_replacement_effect_gate_disabled",
            lastErrorCode: "publication_effect_gate_disabled",
          });
        }
        return this.settlement.terminalizeKnownOutcome({
          command,
          operation: begun.operation,
          claim,
          finalOutcome: ReviewPublicationTerminalOutcome.FailedNoEffect,
          finalReason: "publication_effect_gate_disabled",
          lastErrorCode: "publication_effect_gate_disabled",
          noEffectCapability: capability,
        });
      }
      try {
        applied = await mutationSession.gateway.applyOperation({
          operation: begun.operation,
          capability,
        });
      } catch (error) {
        return this.reconciliation.reconcileAfterMutationFailure({
          command,
          operation: begun.operation,
          claim,
          capability,
          gateway: mutationSession.gateway,
          error,
          priorEffectMayExist,
        });
      }
      validateGatewayObject(applied, begun.operation);

      const effect = await this.settlement.recordOrRestoreEffect({
        operation: begun.operation,
        capability,
        object: applied,
        effectKind: ReviewPublicationExternalEffectKind.MutationAcknowledged,
      });
      if (!effect) {
        return this.settlement.terminalizeKnownAmbiguity({
          command,
          operation: begun.operation,
          claim,
          finalReason: "acknowledged_effect_record_failed",
          lastErrorCode: "effect_record_failed",
        });
      }

      const afterMutation = await this.authority.readFreshness(
        command.provider,
        begun.attempt.permit,
      );
      let observed: readonly ReviewPublicationGatewayObject[];
      try {
        observed = await this.reconciliation.loadInventory(
          mutationSession.gateway,
          begun.operation,
        );
      } catch {
        return this.settlement.terminalizeKnownAmbiguity({
          command,
          operation: begun.operation,
          claim,
          finalReason: "post_mutation_inventory_invalid",
          lastErrorCode: "marker_inventory_invalid",
        });
      }
      const inventoryAfterMutation = mergeGatewayObjects(observed, [applied]);
      if (afterMutation.status !== "current") {
        return this.reconciliation.handleStaleKnownEffect({
          command,
          operation: begun.operation,
          claim,
          permit: begun.attempt.permit,
          gateway: mutationSession.gateway,
          inventory: inventoryAfterMutation,
          freshness: afterMutation,
          lastErrorCode: "post_mutation_freshness_changed",
        });
      }
      return this.reconciliation.settleInventory({
        command,
        operation: begun.operation,
        claim,
        capability,
        gateway: mutationSession.gateway,
        inventory: inventoryAfterMutation,
        effectKind: ReviewPublicationExternalEffectKind.MutationAcknowledged,
      });
    } finally {
      await closePublicationGatewaySession(mutationSession);
    }
  }

  private async acquireClaim(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly reconciliationOnly: boolean;
  }): Promise<
    AcquiredClaim | { readonly result: ReviewV2PublicationExecutionResult }
  > {
    const now = this.dependencies.clock.now();
    const active = input.view.activeClaim;
    if (active && active.expiresAt > now) {
      if (active.ownerIdHash !== input.command.ownerIdHash) {
        return { result: busy("publication_claim_owned_elsewhere") };
      }
      return {
        claim: active,
      };
    }

    const signingKeyId =
      await this.dependencies.capabilityIdentity.activeSigningKeyId();
    assertIdentifier(signingKeyId, "publication_capability_key_invalid");
    const claimCommand = buildClaimCommand(this.dependencies.digestUtf8, {
      view: input.view,
      operation: input.operation,
      ownerIdHash: input.command.ownerIdHash,
      signingKeyId,
      now,
      claimDurationMs: this.policy.claimDurationMs,
    });
    let claimed;
    try {
      claimed = input.reconciliationOnly
        ? await this.dependencies.application.claimForReconciliation(
            claimCommand,
          )
        : await this.dependencies.application.claim(claimCommand);
    } catch {
      return {
        result: input.reconciliationOnly
          ? manual("publication_reconciliation_claim_rejected")
          : await this.settlement.terminalizeUnclaimedNoEffect({
              command: input.command,
              view: input.view,
              operation: input.operation,
              finalReason: "publication_claim_gate_rejected",
              lastErrorCode: "publication_claim_gate_rejected",
            }),
      };
    }
    if (
      claimed.status === ClaimReviewPublicationStatus.Acquired ||
      claimed.status === ClaimReviewPublicationStatus.Restored
    ) {
      return {
        claim: claimed.claim,
      };
    }
    switch (claimed.status) {
      case ClaimReviewPublicationStatus.AlreadyClaimed:
        return { result: busy("publication_claim_owned_elsewhere") };
      case ClaimReviewPublicationStatus.VersionConflict:
        return { result: retryable("publication_claim_version_conflict") };
      case ClaimReviewPublicationStatus.Terminal:
        return {
          result: manual("publication_attempt_terminal_without_receipt"),
        };
      case ClaimReviewPublicationStatus.Missing:
        return { result: manual("publication_attempt_missing") };
      case ClaimReviewPublicationStatus.RequestConflict:
        return { result: manual("publication_claim_request_conflict") };
    }
  }
}
