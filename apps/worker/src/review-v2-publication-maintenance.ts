import {
  ReviewPublicationTerminalOutcome,
  type ReviewPublicationDueWork,
  type ReviewPublicationWorkFeedPort,
} from "@reviewrouter/features-review-publishing/v2";
import type { SystemClock } from "@reviewrouter/shared";
import type { ExecuteReviewV2PublicationOperation } from "./review-v2-publication-executor";
import {
  ReviewV2PublicationExecutionStatus,
  ReviewV2ScmProvider,
} from "./review-v2-publication-ports";
import type {
  ReviewProgressSettlement,
  ReviewV2PublicationMaintenanceRuntime,
} from "./review-v2-worker-runtime";
import { captureWorkerPhase, type WorkerPhaseFailure } from "./worker-phase";

/** Worker-owned, bounded publication drain. Item errors do not erase settled effects. */
export class ReviewV2PublicationMaintenance implements ReviewV2PublicationMaintenanceRuntime {
  constructor(
    private readonly feed: ReviewPublicationWorkFeedPort,
    private readonly executor: Pick<
      ExecuteReviewV2PublicationOperation,
      "execute"
    >,
    private readonly clock: Pick<SystemClock, "now">,
    private readonly ownerIdHash: string,
    private readonly policy: {
      readonly limit: number;
      readonly minimumRetryMs: number;
    },
  ) {}

  async runMaintenance() {
    const now = this.clock.now();
    // A failed scan is a phase failure; there is no reliable settlement subset.
    const work = await this.feed.scan({ now, limit: this.policy.limit });
    let processed = 0;
    let manualRequired = 0;
    let terminalUnknown = 0;
    const itemFailures: WorkerPhaseFailure[] = [];
    const settledExecutionIds = new Set<string>();
    const progressSettlements = new Map<
      string,
      ReviewProgressSettlement["outcome"]
    >();

    for (const item of work) {
      const execution = await captureWorkerPhase(
        "review_v2.publication_item",
        () =>
          this.executor.execute({
            publicationAttemptId: item.publicationAttemptId,
            publicationOperationId: item.publicationOperationId,
            provider: publicationWorkProvider(item.provider),
            ownerIdHash: this.ownerIdHash,
          }),
      );
      let safeReason: string;
      if (execution.status === "failed") {
        itemFailures.push(execution.failure);
        // No terminal receipt can be inferred. Delay only this due item with
        // the existing retry-count CAS, so a poisoned prefix cannot starve work.
        // Reconciliation still owns any uncertain external effect.
        safeReason = "publication_executor_unexpected_failure";
      } else {
        processed += 1;
        const result = execution.value;
        if (
          result.status === ReviewV2PublicationExecutionStatus.ManualRequired
        ) {
          manualRequired += 1;
        }
        if (
          result.status === ReviewV2PublicationExecutionStatus.TerminalUnknown
        ) {
          terminalUnknown += 1;
        }
        if (
          result.status === ReviewV2PublicationExecutionStatus.Completed ||
          result.status ===
            ReviewV2PublicationExecutionStatus.AlreadyCompleted ||
          result.status === ReviewV2PublicationExecutionStatus.Terminalized
        ) {
          settledExecutionIds.add(item.executionId);
          const outcome = progressOutcome(result);
          if (!outcome) continue;
          const previous = progressSettlements.get(item.executionId);
          progressSettlements.set(
            item.executionId,
            strongestProgressOutcome(previous, outcome),
          );
          continue;
        }
        safeReason = result.safeReason;
      }
      const retryDelayMs = Math.max(
        this.policy.minimumRetryMs,
        boundedRetryDelay(item.retryCount + 1),
      );
      const deferred = await captureWorkerPhase(
        "review_v2.publication_defer",
        () =>
          this.feed.defer({
            work: item,
            nextEligibleAt: new Date(now.getTime() + retryDelayMs),
            lastErrorCode: safeReason,
          }),
      );
      if (deferred.status === "failed") itemFailures.push(deferred.failure);
    }
    return {
      processed,
      manualRequired,
      terminalUnknown,
      settledExecutionIds: [...settledExecutionIds].sort(),
      progressSettlements: [...progressSettlements]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([executionId, outcome]) => ({ executionId, outcome })),
      itemFailures,
    };
  }
}

export function progressOutcome(
  result: Awaited<ReturnType<ExecuteReviewV2PublicationOperation["execute"]>>,
): ReviewProgressSettlement["outcome"] | null {
  if (result.status === ReviewV2PublicationExecutionStatus.TerminalUnknown)
    return null;
  if (
    result.status === ReviewV2PublicationExecutionStatus.Completed ||
    result.status === ReviewV2PublicationExecutionStatus.AlreadyCompleted
  )
    return "succeeded";
  if (result.status === ReviewV2PublicationExecutionStatus.Terminalized) {
    if (result.terminalOutcome === ReviewPublicationTerminalOutcome.Succeeded)
      return "succeeded";
    if (
      result.terminalOutcome ===
        ReviewPublicationTerminalOutcome.SupersededNoEffect ||
      result.terminalOutcome ===
        ReviewPublicationTerminalOutcome.StaleCompensated
    )
      return "superseded";
  }
  return "failed";
}

function strongestProgressOutcome(
  previous: ReviewProgressSettlement["outcome"] | undefined,
  next: ReviewProgressSettlement["outcome"],
): ReviewProgressSettlement["outcome"] {
  const rank = { succeeded: 0, superseded: 1, failed: 2 } as const;
  return previous && rank[previous] >= rank[next] ? previous : next;
}

export function publicationWorkProvider(
  provider: ReviewPublicationDueWork["provider"],
): ReviewV2ScmProvider {
  switch (provider) {
    case "github":
      return ReviewV2ScmProvider.GitHub;
    case "gitlab":
      return ReviewV2ScmProvider.GitLab;
  }
}

export function boundedRetryDelay(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
  return Math.min(5_000 * 2 ** exponent, 5 * 60_000);
}
