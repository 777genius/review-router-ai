import type {
  ReviewCompletionClockPort,
  ReviewCompletionIdPort,
  ReviewCompletionProcessRepositoryPort,
} from "../ports/review-completion-process-ports";
import type { AdvanceReviewCompletionProcessResult } from "./advance-review-completion-process";
import { AdvanceReviewCompletionProcess } from "./advance-review-completion-process";

export type ScanDueReviewCompletionProcessesResult = Readonly<{
  results: readonly AdvanceReviewCompletionProcessResult[];
  failures: readonly Readonly<{
    executionId: string;
    code: "review_completion_advance_failed";
  }>[];
}>;

export class ScanDueReviewCompletionProcesses {
  constructor(
    private readonly processes: ReviewCompletionProcessRepositoryPort,
    private readonly advance: AdvanceReviewCompletionProcess,
    private readonly clock: ReviewCompletionClockPort,
    private readonly ids: ReviewCompletionIdPort,
    private readonly claimDurationMs: number,
  ) {
    if (!Number.isSafeInteger(claimDurationMs) || claimDurationMs <= 0) {
      throw new Error("review_completion_invalid_claim_duration");
    }
  }

  async execute(input: {
    readonly ownerIdHash: string;
    readonly limit: number;
    readonly signal?: AbortSignal;
  }): Promise<ScanDueReviewCompletionProcessesResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
      throw new Error("review_completion_invalid_due_scan_limit");
    }
    if (input.signal?.aborted) return { results: [], failures: [] };
    const now = this.clock.now();
    const claims = await this.processes.claimDue({
      now,
      limit: input.limit,
      ownerIdHash: input.ownerIdHash,
      claimIdForExecution: (executionId) => this.ids.nextClaimId(executionId),
      claimUntil: new Date(now.getTime() + this.claimDurationMs),
    });
    // Claim ownership survives an individual rejection. Wait for every sibling
    // before another scan may start, including if stop races the claim query.
    const settled = await Promise.allSettled(
      claims.map((claim) =>
        Promise.resolve().then(() => this.advance.executeClaim(claim)),
      ),
    );
    const results: AdvanceReviewCompletionProcessResult[] = [];
    const failures: Array<{
      executionId: string;
      code: "review_completion_advance_failed";
    }> = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") results.push(outcome.value);
      else
        failures.push({
          executionId: claims[index]!.executionId,
          code: "review_completion_advance_failed",
        });
    });
    return { results, failures };
  }
}
