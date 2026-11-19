import type { Clock } from "@reviewrouter/shared";
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
 */
export class ReviewProgressTerminalPromotion {
  private cursor: PromotionScanCursor | null = null;

  constructor(
    private readonly store: ReviewProgressPromotionStore,
    private readonly clock: Pick<Clock, "now">,
    private readonly pageSize: number = progressPromotionSweepPageSize,
  ) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new Error("review_progress_promotion_page_size_invalid");
    }
  }

  async promote(
    settlements: readonly ReviewProgressSettlement[],
  ): Promise<number> {
    let swept: readonly string[] = [];
    let sweepFailure: { readonly error: unknown } | null = null;
    try {
      const page = await this.store.scanPromotionCandidates({
        after: this.cursor,
        limit: this.pageSize,
      });
      this.cursor = page.nextCursor;
      swept = page.executionIds;
    } catch (error) {
      // A failed sweep read must not hold back this pass's own settlements.
      sweepFailure = { error };
    }
    const promoted = await this.store.promoteSettledExecutions({
      executionIds: [
        ...settlements.map(({ executionId }) => executionId),
        ...swept,
      ],
      now: this.clock.now(),
    });
    if (sweepFailure) throw sweepFailure.error;
    return promoted;
  }
}
