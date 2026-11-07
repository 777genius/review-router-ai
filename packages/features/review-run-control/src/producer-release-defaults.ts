import type {
  ReviewOperationalSloThresholds,
  ReviewProtocolLimits,
} from "./domain/producer-release";

/** Production registration defaults shared by trusted provisioning and installers. */
export const trustedProducerReleaseMaterializationLimits: ReviewProtocolLimits =
  Object.freeze({
    maxWorkSlots: 200,
    maxAttemptsPerSlot: 4,
    maxObservationBytes: 1_000_000,
    maxObservationFindings: 1_000,
    maxProjectionBytes: 2_000_000,
    maxProjectionFindings: 2_000,
    maxPublicationOperations: 500,
    maxPublicationChunks: 500,
    maxPublicationBodyBytes: 2_000_000,
    maxRequestBatchSize: 100,
    maxLeaseDurationMs: 600_000,
    maxResultReportDurationMs: 1_200_000,
    maxReconciliationDurationMs: 3_600_000,
  });

export const trustedProducerReleaseMaterializationThresholds: ReviewOperationalSloThresholds =
  Object.freeze({
    integrationEventDeliveryMs: 60_000,
    outboxClaimAgeMs: 120_000,
    missingCompletionProcessMs: 300_000,
    dueCompletionProcessMs: 300_000,
    publicationReconciliationMs: 600_000,
    v1DrainMs: 3_600_000,
    admissionMs: 30_000,
    pruningBacklogAgeMs: 86_400_000,
  });

export const trustedProducerReleaseMaterializationOwnerRefs = [
  "team-reviewrouter",
] as const;
export const trustedProducerReleaseMaterializationRunbookRefs = [
  "docs/operations/review-action-v2-cutover.md",
] as const;
