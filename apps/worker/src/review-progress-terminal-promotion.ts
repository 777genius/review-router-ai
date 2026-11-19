import type { Logger } from "@reviewrouter/platform-logger";
import type { Clock } from "@reviewrouter/shared";
import { safeWorkerErrorSummary } from "./outbox-worker-loop";
import type { PrismaReviewProgressPublicationStore } from "./review-progress-store";
import type { PromotionScanCursor } from "./review-progress-terminal-persistence";
import type { ReviewProgressSettlement } from "./review-v2-worker-runtime";

/** Publication scopes the sweep reads per maintenance pass. */
export const progressPromotionSweepPageSize = 100;

export type ReviewProgressPromotionStore = Pick<
  PrismaReviewProgressPublicationStore,
  "promoteSettledExecutions" | "scanPromotionCandidates"
>;

/**
 * Moves settled reviews to their terminal progress comment.
 *
 * Settlements seen in this pass are promoted at once. A settlement hint is
 * lost when its promotion transaction fails, when another worker settles the
 * attempt later, or when the worker restarts, and nothing would replay it.
 * One bounded page of a sweep over every publication scope therefore runs on
 * each pass, so a settled review cannot stay at "Assembling results".
 *
 * Only this pass's settlements can fail the phase. A swept candidate is
 * retried on every pass over all scopes, so its failure is logged instead:
 * one bad row must not keep the worker loop on its error delay.
 */
export class ReviewProgressTerminalPromotion {
  private cursor: PromotionScanCursor | null = null;
  /** Executions already reported, so a bad row warns once per process. */
  private readonly reported = new Set<string>();
  private readonly pageSize: number;
  private readonly logger: Pick<Logger, "warn">;

  constructor(
    private readonly store: ReviewProgressPromotionStore,
    private readonly clock: Pick<Clock, "now">,
    options: Readonly<{
      pageSize?: number;
      logger?: Pick<Logger, "warn">;
    }> = {},
  ) {
    this.pageSize = options.pageSize ?? progressPromotionSweepPageSize;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1) {
      throw new Error("review_progress_promotion_page_size_invalid");
    }
    this.logger = options.logger ?? console;
  }

  async promote(
    settlements: readonly ReviewProgressSettlement[],
  ): Promise<number> {
    const hinted = new Set(settlements.map(({ executionId }) => executionId));
    let swept: readonly string[] = [];
    let sweepFailure: { readonly error: unknown } | null = null;
    try {
      const page = await this.store.scanPromotionCandidates({
        after: this.cursor,
        limit: this.pageSize,
      });
      this.cursor = page.nextCursor;
      swept = page.executionIds.filter((id) => !hinted.has(id));
    } catch (error) {
      // A failed sweep read must not hold back this pass's own settlements.
      sweepFailure = { error };
    }
    const promoted =
      (await this.promoteSwept(swept)) +
      (await this.store.promoteSettledExecutions({
        executionIds: [...hinted],
        now: this.clock.now(),
      }));
    if (sweepFailure) throw sweepFailure.error;
    return promoted;
  }

  private async promoteSwept(executionIds: readonly string[]) {
    let promoted = 0;
    for (const executionId of executionIds) {
      try {
        promoted += await this.store.promoteSettledExecutions({
          executionIds: [executionId],
          now: this.clock.now(),
        });
      } catch (error) {
        if (this.reported.has(executionId)) continue;
        this.reported.add(executionId);
        this.logger.warn("Review progress sweep could not promote a review", {
          executionId,
          safeErrorSummary: safeWorkerErrorSummary(error),
        });
      }
    }
    return promoted;
  }
}
