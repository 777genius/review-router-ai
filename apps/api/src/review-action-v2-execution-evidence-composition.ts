import {
  type RegisterReviewEvidenceV2RoutesDependencies,
  type RegisterReviewExecutionV2RoutesDependencies,
} from "@reviewrouter/features-action-control-plane/v2";
import {
  type ReviewEvidenceCommitRequest,
  type ReviewEvidenceLookupRequest,
  type ReviewExecutionFinalizeRequest,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewExecutionObservationAttachRequest,
  type ReviewExecutionRestoreRequest,
  type ReviewExecutionStartRequest,
  type ReviewExecutionSupersedeRequest,
  type ReviewExecutionWorkSlotTerminalizeRequest,
  type ReviewInvocationLeaseAcquireRequest,
  type ReviewInvocationLeaseReleaseRequest,
  type ReviewInvocationLeaseRenewRequest,
} from "@reviewrouter/protocol-review-action-v2";
import {
  type ReviewActionV2ExecutionHandlerDependencies,
  type ReviewActionV2EvidenceHandlerDependencies,
} from "./review-action-v2-execution-evidence-dependencies.js";
import { validateTiming } from "./review-action-v2-execution-evidence-validation.js";
import {
  restoreExecution,
  startExecution,
  supersedeExecution,
  terminalizeWorkSlot,
  finalizeExecution,
} from "./review-action-v2-execution-evidence-lifecycle.js";
import {
  attachObservation,
  adoptObservation,
} from "./review-action-v2-execution-evidence-observations.js";
import {
  acquireLease,
  renewLease,
  releaseLease,
} from "./review-action-v2-execution-evidence-leases.js";
import {
  lookupEvidence,
  commitEvidence,
} from "./review-action-v2-evidence-handlers.js";

// API route assembly; operation handlers retain their owning validation and lifecycle.

export type {
  ReviewActionV2AuthorizationResolverPort,
  ReviewActionV2DigestPort,
  ReviewActionV2ExecutionTimingPolicy,
  ReviewActionV2LeaseSafetyPort,
  ReviewActionV2FinalizationFactsPort,
  ReviewActionV2ExecutionHandlerDependencies,
  ReviewActionV2EvidenceHandlerDependencies,
} from "./review-action-v2-execution-evidence-dependencies.js";

export function composeReviewActionV2ExecutionRoutes(input: {
  readonly enabled: boolean;
  readonly runtime: Pick<
    RegisterReviewExecutionV2RoutesDependencies,
    "readServerTime" | "createRequestId"
  >;
  readonly handlers?: ReviewActionV2ExecutionHandlerDependencies;
}): RegisterReviewExecutionV2RoutesDependencies {
  if (!input.enabled) return input.runtime;
  if (!input.handlers)
    throw new Error("review_action_v2_execution_dependencies_unavailable");
  return {
    ...input.runtime,
    ...createReviewActionV2ExecutionHandlers(input.handlers),
  };
}

export function composeReviewActionV2EvidenceRoutes(input: {
  readonly enabled: boolean;
  readonly runtime: Pick<
    RegisterReviewEvidenceV2RoutesDependencies,
    "readServerTime" | "createRequestId"
  >;
  readonly handlers?: ReviewActionV2EvidenceHandlerDependencies;
}): RegisterReviewEvidenceV2RoutesDependencies {
  if (!input.enabled) return input.runtime;
  if (!input.handlers)
    throw new Error("review_action_v2_evidence_dependencies_unavailable");
  return {
    ...input.runtime,
    ...createReviewActionV2EvidenceHandlers(input.handlers),
  };
}

export function createReviewActionV2ExecutionHandlers(
  d: ReviewActionV2ExecutionHandlerDependencies,
) {
  validateTiming(d.timing);
  return {
    restore: enabled((request: ReviewExecutionRestoreRequest) =>
      restoreExecution(request, d),
    ),
    start: enabled((request: ReviewExecutionStartRequest) =>
      startExecution(request, d),
    ),
    supersede: enabled((request: ReviewExecutionSupersedeRequest) =>
      supersedeExecution(request, d),
    ),
    terminalizeWorkSlot: enabled(
      (request: ReviewExecutionWorkSlotTerminalizeRequest) =>
        terminalizeWorkSlot(request, d),
    ),
    attachObservation: enabled(
      (request: ReviewExecutionObservationAttachRequest) =>
        attachObservation(request, d),
    ),
    adoptObservation: enabled(
      (request: ReviewExecutionObservationAdoptRequest) =>
        adoptObservation(request, d),
    ),
    finalize: enabled((request: ReviewExecutionFinalizeRequest) =>
      finalizeExecution(request, d),
    ),
    acquireLease: enabled(
      async (request: ReviewInvocationLeaseAcquireRequest) => {
        const response = await acquireLease(request, d);
        try {
          console.info("review_invocation_lease_acquire_outcome", {
            status: response.result.status,
            rejectionReason:
              "rejectionReason" in response.result
                ? response.result.rejectionReason
                : null,
            executionId: request.executionId,
            workSlotId: request.workSlotId,
          });
        } catch {
          // Diagnostics cannot change the selected response or lease outcome.
        }
        return response;
      },
    ),
    renewLease: enabled((request: ReviewInvocationLeaseRenewRequest) =>
      renewLease(request, d),
    ),
    releaseLease: enabled((request: ReviewInvocationLeaseReleaseRequest) =>
      releaseLease(request, d),
    ),
  } satisfies Partial<RegisterReviewExecutionV2RoutesDependencies>;
}

export function createReviewActionV2EvidenceHandlers(
  d: ReviewActionV2EvidenceHandlerDependencies,
) {
  validateTiming(d.timing);
  return {
    lookup: enabled((request: ReviewEvidenceLookupRequest) =>
      lookupEvidence(request, d),
    ),
    commit: enabled((request: ReviewEvidenceCommitRequest) =>
      commitEvidence(request, d),
    ),
  } satisfies Partial<RegisterReviewEvidenceV2RoutesDependencies>;
}

function enabled<Request, Result>(
  execute: (request: Request) => Promise<Result>,
) {
  return { capabilityEnabled: true as const, execute };
}
