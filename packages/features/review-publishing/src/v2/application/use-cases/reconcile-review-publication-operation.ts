import {
  type ReviewPublicationAttemptView,
  type ReviewPublicationGatewayObject,
  type ReviewPublicationAttemptQueryPort,
} from "../ports/review-publication-ports";
import {
  ReviewPublicationExternalEffectKind,
  ReviewPublicationKind,
  ReviewPublicationReceiptStatus,
  ReviewPublicationTerminalOutcome,
  isOptionalPrDescriptionOperation,
  type ReviewPublicationClaimTerm,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
  type ReviewPublicationPermitIdentity,
} from "../../domain/review-publication-attempt";
import {
  ReviewV2PublicationCompensationDecision,
  ReviewV2PublicationEffectGateDecision,
  ReviewV2PublicationFreshnessReadStatus,
  ReviewV2ScmCredentialPurpose,
  ReviewV2ScmMutationError,
  ReviewV2ScmMutationFailureOutcome,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
  type ReviewV2PublicationFreshnessRead,
  type ReviewV2ScmGatewaySession,
  type ReviewV2ScmReconciliationGateway,
  type ReviewV2PublicationFreshnessPort,
  type ReviewV2PublicationCompensationPolicyPort,
  type ReviewV2OperationCapabilityIssuerPort,
  type ReviewV2ScmCredentialAcquisitionPort,
  type ReviewV2PublicationClockPort,
} from "../ports/review-publication-execution-ports";
import {
  canonicalVisibleEffect,
  normalizeInventory,
  currentOperationObjects,
  hasCurrentOperationObject,
  sameFreshness,
  reconciliationRiskOperations,
  retryable,
  manual,
  type FreshnessAssessment,
} from "../services/review-publication-execution-state";
import { PublicationExecutionAuthority } from "../services/publication-execution-authority";
import { PublicationOperationSettlement } from "../services/publication-operation-settlement";

type ReconciliationResult =
  | {
      readonly settled: false;
      readonly claim: ReviewPublicationClaimTerm;
      readonly capability: ReviewPublicationOperationCapabilityFacts;
    }
  | {
      readonly settled: true;
      readonly result: ReviewV2PublicationExecutionResult;
    };

type PublicationOperationReconciliationDependencies = {
  readonly attempts: ReviewPublicationAttemptQueryPort;
  readonly freshness: ReviewV2PublicationFreshnessPort;
  readonly compensation: ReviewV2PublicationCompensationPolicyPort;
  readonly operationCapabilities: ReviewV2OperationCapabilityIssuerPort;
  readonly credentials: ReviewV2ScmCredentialAcquisitionPort;
  readonly clock: ReviewV2PublicationClockPort;
};

/** Reconciles external inventory while keeping every credential session locally scoped. */
export class ReconcileReviewPublicationOperation {
  constructor(
    private readonly dependencies: PublicationOperationReconciliationDependencies,
    private readonly authority: PublicationExecutionAuthority,
    private readonly settlement: PublicationOperationSettlement,
    private readonly maxMarkerPages: number,
  ) {}

  async removeStalePendingReviewBeforeMutation(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly permit: ReviewPublicationPermitIdentity;
    readonly claim: ReviewPublicationClaimTerm;
    readonly gateway: ReviewV2ScmReconciliationGateway;
    readonly inventory: readonly ReviewPublicationGatewayObject[];
    readonly priorEffectMayExist: boolean;
  }): Promise<
    | {
        readonly claim: ReviewPublicationClaimTerm;
        readonly inventory: readonly ReviewPublicationGatewayObject[];
        readonly cleanupMayHaveExternalEffect: boolean;
      }
    | { readonly result: ReviewV2PublicationExecutionResult }
  > {
    if (
      input.operation.publicationKind !==
        ReviewPublicationKind.PendingReviewCreate ||
      input.inventory.length === 0
    ) {
      return {
        claim: input.claim,
        inventory: input.inventory,
        cleanupMayHaveExternalEffect: false,
      };
    }

    const staleObjects = normalizeInventory(input.inventory, input.operation);
    let claim = input.claim;
    const cleanupLease = await this.authority.renewForMutation(
      input.command,
      claim,
    );
    if ("result" in cleanupLease) return cleanupLease;
    claim = cleanupLease.claim;

    const beforeCleanup = await this.authority.readFreshness(
      input.command.provider,
      input.permit,
    );
    if (beforeCleanup.status !== "current") {
      return {
        result:
          beforeCleanup.status === "unavailable"
            ? retryable(beforeCleanup.safeReason)
            : input.priorEffectMayExist
              ? await this.settlement.terminalizeKnownAmbiguity({
                  command: input.command,
                  operation: input.operation,
                  claim,
                  finalReason:
                    "pending_review_replacement_freshness_changed_after_possible_effect",
                  lastErrorCode: beforeCleanup.safeReason,
                })
              : await this.settlement.terminalizeKnownOutcome({
                  command: input.command,
                  operation: input.operation,
                  claim,
                  finalOutcome:
                    ReviewPublicationTerminalOutcome.SupersededNoEffect,
                  finalReason: "publication_live_facts_superseded",
                  lastErrorCode: beforeCleanup.safeReason,
                }),
      };
    }

    const finalCleanupLease = await this.authority.renewForMutation(
      input.command,
      claim,
    );
    if ("result" in finalCleanupLease) return finalCleanupLease;
    claim = finalCleanupLease.claim;
    const effectDecision = await this.authority.authorizeEffect(
      input.command.provider,
      input.permit,
      input.operation,
    );
    if (effectDecision !== ReviewV2PublicationEffectGateDecision.Allowed) {
      return {
        result:
          effectDecision === ReviewV2PublicationEffectGateDecision.Unavailable
            ? retryable("publication_effect_gate_unavailable")
            : manual("publication_effect_gate_disabled"),
      };
    }

    const [canonical, ...duplicates] = staleObjects;
    if (!canonical) {
      return { claim, inventory: [], cleanupMayHaveExternalEffect: false };
    }
    try {
      const cleanupStatus = await input.gateway.markStaleOrDelete({
        operation: input.operation,
        canonicalExternalObjectId: canonical.externalObjectId,
        duplicateExternalObjectIds: duplicates.map(
          (object) => object.externalObjectId,
        ),
        compensateCanonical: true,
      });
      if (
        cleanupStatus !== ReviewPublicationReceiptStatus.Compensated &&
        cleanupStatus !== ReviewPublicationReceiptStatus.Succeeded
      ) {
        return {
          result: manual("publication_pending_review_replacement_unsupported"),
        };
      }
    } catch {
      return {
        result: retryable("publication_pending_review_replacement_unknown"),
      };
    }

    const afterCleanup = await this.authority.readFreshness(
      input.command.provider,
      input.permit,
    );
    if (
      afterCleanup.status !== "current" ||
      !sameFreshness(beforeCleanup.snapshot, afterCleanup.snapshot)
    ) {
      return {
        result:
          afterCleanup.status === "unavailable"
            ? retryable(afterCleanup.safeReason)
            : await this.settlement.terminalizeKnownAmbiguity({
                command: input.command,
                operation: input.operation,
                claim,
                finalReason: "pending_review_replacement_freshness_changed",
                lastErrorCode:
                  afterCleanup.status === "changed"
                    ? afterCleanup.safeReason
                    : "publication_live_facts_changed",
              }),
      };
    }

    let inventory: readonly ReviewPublicationGatewayObject[];
    try {
      inventory = await this.loadInventory(input.gateway, input.operation);
    } catch {
      return {
        result: retryable("publication_pending_review_replacement_unverified"),
      };
    }
    const removedIds = new Set(
      staleObjects.map((object) => object.externalObjectId),
    );
    if (inventory.some((object) => removedIds.has(object.externalObjectId))) {
      return {
        result: retryable("publication_pending_review_replacement_incomplete"),
      };
    }
    return { claim, inventory, cleanupMayHaveExternalEffect: true };
  }

  async reconcileBeforeRetry(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly view: ReviewPublicationAttemptView;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
  }): Promise<ReconciliationResult> {
    if (this.dependencies.clock.now() >= input.operation.reconcileUntil) {
      return {
        settled: true,
        result: await this.settlement.terminalizeOrRetry({
          command: input.command,
          view: input.view,
          operation: input.operation,
          claim: input.claim,
          finalReason: "reconciliation_window_exhausted",
          lastErrorCode: "publication_retry_window_exhausted",
        }),
      };
    }
    const renewed = await this.authority.renewForMutation(
      input.command,
      input.claim,
    );
    if ("result" in renewed) {
      return { settled: true, result: renewed.result };
    }
    const claim = renewed.claim;
    const credentialFreshness = await this.authority.readFreshness(
      input.command.provider,
      input.view.attempt.permit,
    );
    if (credentialFreshness.status === "unavailable") {
      return {
        settled: true,
        result: retryable(credentialFreshness.safeReason),
      };
    }
    let signedCapability;
    try {
      signedCapability = await this.dependencies.operationCapabilities.issue({
        permit: input.view.attempt.permit,
        operation: input.operation,
        capability: input.capability,
        claim,
      });
    } catch {
      return {
        settled: true,
        result: retryable("publication_operation_capability_unavailable"),
      };
    }
    let session: ReviewV2ScmGatewaySession;
    try {
      session = await this.dependencies.credentials.acquire({
        provider: input.command.provider,
        purpose: ReviewV2ScmCredentialPurpose.ReconcileOnly,
        permit: input.view.attempt.permit,
        operation: input.operation,
        capability: input.capability,
        claim,
        signedCapability,
      });
    } catch {
      return {
        settled: true,
        result: await this.settlement.terminalizeOrRetry({
          command: input.command,
          view: input.view,
          operation: input.operation,
          claim,
          finalReason: "reconciliation_credential_unavailable",
          lastErrorCode: "scm_credential_unavailable",
        }),
      };
    }
    try {
      let inventory: readonly ReviewPublicationGatewayObject[];
      try {
        inventory = await this.loadInventory(session.gateway, input.operation);
      } catch {
        return {
          settled: true,
          result: await this.settlement.terminalizeOrRetry({
            command: input.command,
            view: input.view,
            operation: input.operation,
            claim,
            finalReason: "reconciliation_inventory_invalid",
            lastErrorCode: "marker_inventory_invalid",
          }),
        };
      }
      if (!hasCurrentOperationObject(inventory, input.operation)) {
        if (
          input.operation.publicationKind ===
          ReviewPublicationKind.PrDescription
        ) {
          return {
            settled: true,
            result: await this.settlement.terminalizeOrRetry({
              command: input.command,
              view: input.view,
              operation: input.operation,
              claim,
              finalReason: "pr_description_prior_write_unreconciled",
              lastErrorCode: "pr_description_write_outcome_unknown",
            }),
          };
        }
        const freshness = await this.authority.readFreshness(
          input.command.provider,
          input.view.attempt.permit,
        );
        if (
          freshness.status === "current" &&
          this.dependencies.clock.now() < input.operation.reconcileUntil
        ) {
          return {
            settled: false,
            claim,
            capability: input.capability,
          };
        }
        return {
          settled: true,
          result: await this.settlement.terminalizeOrRetry({
            command: input.command,
            view: input.view,
            operation: input.operation,
            claim,
            finalReason: "reconciliation_inventory_empty",
            lastErrorCode:
              freshness.status === "current"
                ? "publication_retry_window_exhausted"
                : freshness.safeReason,
          }),
        };
      }
      return {
        settled: true,
        result: await this.settleInventory({
          command: input.command,
          operation: input.operation,
          claim,
          capability: input.capability,
          gateway: session.gateway,
          inventory,
          effectKind: ReviewPublicationExternalEffectKind.MarkerReconciled,
        }),
      };
    } finally {
      await closePublicationGatewaySession(session);
    }
  }

  async reconcileAfterMutationFailure(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
    readonly gateway: ReviewV2ScmReconciliationGateway;
    readonly error: unknown;
    readonly priorEffectMayExist?: boolean;
  }): Promise<ReviewV2PublicationExecutionResult> {
    if (
      input.priorEffectMayExist !== true &&
      input.error instanceof ReviewV2ScmMutationError &&
      input.error.outcome ===
        ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect
    ) {
      return input.error.retryable
        ? retryable(input.error.safeCode)
        : this.settlement.terminalizeKnownOutcome({
            command: input.command,
            operation: input.operation,
            claim: input.claim,
            finalOutcome: ReviewPublicationTerminalOutcome.FailedNoEffect,
            finalReason: "scm_mutation_rejected_no_effect",
            lastErrorCode: input.error.safeCode,
            noEffectCapability: input.capability,
          });
    }
    if (
      input.operation.publicationKind === ReviewPublicationKind.PrDescription &&
      input.error instanceof ReviewV2ScmMutationError &&
      input.error.safeCode === "github_pr_description_post_write_conflict"
    ) {
      return manual(input.error.safeCode);
    }
    const errorCode =
      input.error instanceof ReviewV2ScmMutationError
        ? input.error.safeCode
        : "scm_mutation_outcome_unknown";
    let inventory: readonly ReviewPublicationGatewayObject[];
    try {
      inventory = await this.loadInventory(input.gateway, input.operation);
    } catch {
      return this.settlement.terminalizeKnownAmbiguity({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        finalReason: "mutation_reconciliation_inventory_invalid",
        lastErrorCode: errorCode,
      });
    }
    if (hasCurrentOperationObject(inventory, input.operation)) {
      return this.settleInventory({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        capability: input.capability,
        gateway: input.gateway,
        inventory,
        effectKind: ReviewPublicationExternalEffectKind.MarkerReconciled,
      });
    }
    return this.settlement.terminalizeKnownAmbiguity({
      command: input.command,
      operation: input.operation,
      claim: input.claim,
      finalReason: "scm_mutation_outcome_unknown",
      lastErrorCode: errorCode,
    });
  }

  async settleInventory(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
    readonly gateway: ReviewV2ScmReconciliationGateway;
    readonly inventory: readonly ReviewPublicationGatewayObject[];
    readonly effectKind: ReviewPublicationExternalEffectKind;
  }): Promise<ReviewV2PublicationExecutionResult> {
    const objects = normalizeInventory(input.inventory, input.operation);
    if (objects.length === 0) {
      return retryable("publication_marker_inventory_empty");
    }
    const currentObjects = currentOperationObjects(objects, input.operation);
    if (currentObjects.length === 0) {
      return retryable("publication_current_marker_not_visible");
    }
    if (
      input.capability.targetExternalObjectId !== null &&
      objects.some(
        (object) =>
          object.externalObjectId !== input.capability.targetExternalObjectId,
      )
    ) {
      return this.settlement.terminalizeKnownAmbiguity({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        finalReason: "publication_dependency_target_conflict",
        lastErrorCode: "marker_target_conflict",
      });
    }

    let view = await this.dependencies.attempts.findById(
      input.command.publicationAttemptId,
    );
    if (!view) return manual("publication_attempt_disappeared");
    let effect = canonicalVisibleEffect(view, input.operation, currentObjects);
    if (!effect) {
      const preferred = currentObjects[0];
      if (!preferred) return retryable("publication_marker_inventory_empty");
      await this.settlement.recordOrRestoreEffect({
        operation: input.operation,
        capability: input.capability,
        object: preferred,
        effectKind: input.effectKind,
      });
      view = await this.dependencies.attempts.findById(
        input.command.publicationAttemptId,
      );
      if (!view) return manual("publication_attempt_disappeared");
      effect = canonicalVisibleEffect(view, input.operation, currentObjects);
    }
    if (!effect) {
      return this.settlement.terminalizeKnownAmbiguity({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        finalReason: "marker_effect_not_recordable",
        lastErrorCode: "effect_record_failed",
      });
    }
    const canonicalObject = objects.find(
      (object) => object.externalObjectId === effect.externalObjectId,
    );
    if (!canonicalObject) {
      return this.settlement.terminalizeKnownAmbiguity({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        finalReason: "canonical_effect_not_in_inventory",
        lastErrorCode: "marker_inventory_drift",
      });
    }
    const duplicates = objects.filter(
      (object) => object.externalObjectId !== canonicalObject.externalObjectId,
    );
    const freshness = await this.authority.readFreshness(
      input.command.provider,
      view.attempt.permit,
    );
    if (freshness.status !== "current") {
      if (reconciliationRiskOperations(view, input.operation).length > 1) {
        return this.settlement.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: input.claim,
          finalReason:
            "multiple_stale_effects_require_aggregate_reconciliation",
          lastErrorCode: freshness.safeReason,
        });
      }
      return this.handleStaleKnownEffect({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        permit: view.attempt.permit,
        gateway: input.gateway,
        inventory: objects,
        freshness,
        lastErrorCode: "publication_freshness_changed",
      });
    }

    if (duplicates.length > 0) {
      let cleanupStatus: ReviewPublicationReceiptStatus;
      let cleanupClaim = input.claim;
      try {
        const cleanupLease = await this.authority.renewForMutation(
          input.command,
          input.claim,
        );
        if ("result" in cleanupLease) return cleanupLease.result;
        cleanupClaim = cleanupLease.claim;
        const immediatelyBeforeCleanup = await this.authority.readFreshness(
          input.command.provider,
          view.attempt.permit,
        );
        if (
          immediatelyBeforeCleanup.status !== "current" ||
          !sameFreshness(freshness.snapshot, immediatelyBeforeCleanup.snapshot)
        ) {
          return this.handleStaleKnownEffect({
            command: input.command,
            operation: input.operation,
            claim: cleanupClaim,
            permit: view.attempt.permit,
            gateway: input.gateway,
            inventory: objects,
            freshness:
              immediatelyBeforeCleanup.status === "current"
                ? {
                    status: "changed",
                    snapshot: immediatelyBeforeCleanup.snapshot,
                    safeReason: "publication_live_facts_changed",
                  }
                : immediatelyBeforeCleanup,
            lastErrorCode: "pre_cleanup_freshness_changed",
          });
        }
        const finalCleanupLease = await this.authority.renewForMutation(
          input.command,
          cleanupClaim,
        );
        if ("result" in finalCleanupLease) return finalCleanupLease.result;
        cleanupClaim = finalCleanupLease.claim;
        const cleanupDecision = await this.authority.authorizeEffect(
          input.command.provider,
          view.attempt.permit,
          input.operation,
        );
        if (cleanupDecision !== ReviewV2PublicationEffectGateDecision.Allowed) {
          return cleanupDecision ===
            ReviewV2PublicationEffectGateDecision.Unavailable
            ? retryable("publication_effect_gate_unavailable")
            : manual("publication_effect_gate_disabled");
        }
        cleanupStatus = await input.gateway.markStaleOrDelete({
          operation: input.operation,
          canonicalExternalObjectId: canonicalObject.externalObjectId,
          duplicateExternalObjectIds: duplicates.map(
            (object) => object.externalObjectId,
          ),
          compensateCanonical: false,
        });
      } catch {
        return this.settlement.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: cleanupClaim,
          finalReason: "duplicate_cleanup_outcome_unknown",
          lastErrorCode: "duplicate_cleanup_request_failed",
        });
      }
      const afterCleanup = await this.authority.readFreshness(
        input.command.provider,
        view.attempt.permit,
      );
      if (
        cleanupStatus !== ReviewPublicationReceiptStatus.Succeeded ||
        afterCleanup.status !== "current" ||
        !sameFreshness(freshness.snapshot, afterCleanup.snapshot)
      ) {
        return this.settlement.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: cleanupClaim,
          finalReason: "duplicate_cleanup_not_converged",
          lastErrorCode: "duplicate_cleanup_uncertain",
        });
      }
    }

    const finalFreshness = await this.authority.readFreshness(
      input.command.provider,
      view.attempt.permit,
    );
    if (finalFreshness.status !== "current") {
      if (reconciliationRiskOperations(view, input.operation).length > 1) {
        return this.settlement.terminalizeKnownAmbiguity({
          command: input.command,
          operation: input.operation,
          claim: input.claim,
          finalReason:
            "multiple_stale_effects_require_aggregate_reconciliation",
          lastErrorCode: finalFreshness.safeReason,
        });
      }
      return this.handleStaleKnownEffect({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        permit: view.attempt.permit,
        gateway: input.gateway,
        inventory: objects,
        freshness: finalFreshness,
        lastErrorCode: "pre_completion_freshness_changed",
      });
    }
    return this.settlement.completeCanonicalOperation({
      command: input.command,
      operation: input.operation,
      claim: input.claim,
      effect,
    });
  }

  async handleStaleKnownEffect(input: {
    readonly command: ReviewV2PublicationExecutionCommand;
    readonly operation: ReviewPublicationOperation;
    readonly claim: ReviewPublicationClaimTerm;
    readonly permit: ReviewPublicationPermitIdentity;
    readonly gateway: ReviewV2ScmReconciliationGateway;
    readonly inventory: readonly ReviewPublicationGatewayObject[];
    readonly freshness: Exclude<
      FreshnessAssessment,
      { readonly status: "current" }
    >;
    readonly lastErrorCode: string;
  }): Promise<ReviewV2PublicationExecutionResult> {
    if (isOptionalPrDescriptionOperation(input.operation)) {
      // Closing inference can revoke the run while its accepted body write is
      // returning. Settle that known effect without authorizing another write.
      try {
        const view = await this.dependencies.attempts.findById(
          input.command.publicationAttemptId,
        );
        const visible = currentOperationObjects(
          await this.loadInventory(input.gateway, input.operation),
          input.operation,
        );
        const effect = view
          ? canonicalVisibleEffect(view, input.operation, visible)
          : null;
        if (
          effect?.effectKind ===
            ReviewPublicationExternalEffectKind.MutationAcknowledged &&
          visible.some(
            (object) =>
              object.externalObjectId === effect.externalObjectId &&
              object.observedObjectHash === effect.observedObjectHash,
          )
        ) {
          return this.settlement.terminalizeKnownOutcome({
            command: input.command,
            operation: input.operation,
            claim: input.claim,
            finalOutcome: ReviewPublicationTerminalOutcome.StaleVisible,
            finalReason: "optional_pr_description_stale_visible",
            lastErrorCode: input.lastErrorCode,
          });
        }
      } catch {
        // Missing readback remains ambiguous; never replay the body mutation.
      }
      return this.settlement.terminalizeKnownAmbiguity({
        command: input.command,
        operation: input.operation,
        claim: input.claim,
        finalReason: "optional_pr_description_stale_visible",
        lastErrorCode: input.lastErrorCode,
      });
    }
    const objects = normalizeInventory(input.inventory, input.operation);
    const currentObjects = currentOperationObjects(objects, input.operation);
    if (input.freshness.status === "changed" && input.freshness.snapshot) {
      const canonicalObject = currentObjects[0];
      if (canonicalObject) {
        const duplicates = objects.filter(
          (object) =>
            object.externalObjectId !== canonicalObject.externalObjectId,
        );
        const decision = await this.dependencies.compensation.decide({
          operation: input.operation,
          canonicalObject,
          duplicateObjects: duplicates,
          liveFacts: input.freshness.snapshot,
        });
        if (decision === ReviewV2PublicationCompensationDecision.Allowed) {
          let compensationClaim = input.claim;
          try {
            const compensationLease = await this.authority.renewForMutation(
              input.command,
              input.claim,
            );
            if ("result" in compensationLease) {
              return compensationLease.result;
            }
            compensationClaim = compensationLease.claim;
            const immediatelyBeforeCompensation =
              await this.authority.readFreshness(
                input.command.provider,
                input.permit,
              );
            if (
              immediatelyBeforeCompensation.status !== "changed" ||
              immediatelyBeforeCompensation.snapshot === null ||
              !sameFreshness(
                input.freshness.snapshot,
                immediatelyBeforeCompensation.snapshot,
              )
            ) {
              return this.settlement.terminalizeKnownAmbiguity({
                command: input.command,
                operation: input.operation,
                claim: compensationClaim,
                finalReason: "compensation_precheck_changed",
                lastErrorCode: "compensation_freshness_changed",
              });
            }
            const finalCompensationLease =
              await this.authority.renewForMutation(
                input.command,
                compensationClaim,
              );
            if ("result" in finalCompensationLease) {
              return finalCompensationLease.result;
            }
            compensationClaim = finalCompensationLease.claim;
            const compensationEffectDecision =
              await this.authority.authorizeEffect(
                input.command.provider,
                input.permit,
                input.operation,
              );
            if (
              compensationEffectDecision !==
              ReviewV2PublicationEffectGateDecision.Allowed
            ) {
              return compensationEffectDecision ===
                ReviewV2PublicationEffectGateDecision.Unavailable
                ? retryable("publication_effect_gate_unavailable")
                : manual("publication_effect_gate_disabled");
            }
            const compensationStatus = await input.gateway.markStaleOrDelete({
              operation: input.operation,
              canonicalExternalObjectId: canonicalObject.externalObjectId,
              duplicateExternalObjectIds: duplicates.map(
                (object) => object.externalObjectId,
              ),
              compensateCanonical: true,
            });
            if (
              compensationStatus === ReviewPublicationReceiptStatus.StaleVisible
            ) {
              return this.settlement.terminalizeKnownOutcome({
                command: input.command,
                operation: input.operation,
                claim: compensationClaim,
                finalOutcome: ReviewPublicationTerminalOutcome.StaleVisible,
                finalReason: "stale_effect_remains_visible",
                lastErrorCode: input.lastErrorCode,
              });
            }
          } catch {
            return this.settlement.terminalizeKnownAmbiguity({
              command: input.command,
              operation: input.operation,
              claim: compensationClaim,
              finalReason: "compensation_outcome_unknown",
              lastErrorCode: "compensation_request_failed",
            });
          }
          try {
            const remaining = await this.loadInventory(
              input.gateway,
              input.operation,
            );
            if (
              remaining.some(
                (object) =>
                  object.externalObjectId === canonicalObject.externalObjectId,
              )
            ) {
              return this.settlement.terminalizeKnownOutcome({
                command: input.command,
                operation: input.operation,
                claim: compensationClaim,
                finalOutcome: ReviewPublicationTerminalOutcome.StaleVisible,
                finalReason: "stale_effect_remains_visible",
                lastErrorCode: input.lastErrorCode,
              });
            }
          } catch {
            return this.settlement.terminalizeKnownAmbiguity({
              command: input.command,
              operation: input.operation,
              claim: compensationClaim,
              finalReason: "compensation_inventory_unavailable",
              lastErrorCode: "compensation_inventory_unavailable",
            });
          }
          let afterCompensation: ReviewV2PublicationFreshnessRead;
          try {
            afterCompensation = await this.dependencies.freshness.read(
              input.command.provider,
              input.permit,
            );
          } catch {
            return this.settlement.terminalizeKnownAmbiguity({
              command: input.command,
              operation: input.operation,
              claim: compensationClaim,
              finalReason: "compensation_postcheck_unavailable",
              lastErrorCode: "freshness_read_failed",
            });
          }
          if (
            afterCompensation.status !==
              ReviewV2PublicationFreshnessReadStatus.Available ||
            !sameFreshness(input.freshness.snapshot, afterCompensation.snapshot)
          ) {
            return this.settlement.terminalizeKnownAmbiguity({
              command: input.command,
              operation: input.operation,
              claim: compensationClaim,
              finalReason: "compensation_postcheck_changed",
              lastErrorCode: "compensation_outcome_uncertain",
            });
          }
          return this.settlement.terminalizeKnownOutcome({
            command: input.command,
            operation: input.operation,
            claim: compensationClaim,
            finalOutcome: ReviewPublicationTerminalOutcome.StaleCompensated,
            finalReason: "stale_effect_compensated",
            lastErrorCode: input.lastErrorCode,
          });
        }
      }
    }
    return this.settlement.terminalizeKnownAmbiguity({
      command: input.command,
      operation: input.operation,
      claim: input.claim,
      finalReason: "stale_effect_requires_manual_reconciliation",
      lastErrorCode: input.lastErrorCode,
    });
  }

  async loadInventory(
    gateway: ReviewV2ScmReconciliationGateway,
    operation: ReviewPublicationOperation,
  ): Promise<readonly ReviewPublicationGatewayObject[]> {
    const objects: ReviewPublicationGatewayObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < this.maxMarkerPages; page += 1) {
      const result = await gateway.findAllByMarker({ operation, cursor });
      objects.push(...result.objects);
      if (result.nextCursor === null) {
        return normalizeInventory(objects, operation);
      }
      if (
        result.nextCursor.trim().length === 0 ||
        seenCursors.has(result.nextCursor)
      ) {
        throw new Error("publication_marker_cursor_invalid");
      }
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("publication_marker_pagination_limit_exceeded");
  }
}

export async function closePublicationGatewaySession(
  session: ReviewV2ScmGatewaySession,
): Promise<void> {
  try {
    await session.close();
  } catch {
    // Credential disposal is best-effort after the scoped client is unreachable.
  }
}
