import type { Prisma } from "@prisma/client";
import type { AcquireReviewInvocationLeaseCommand } from "../../application/ports/review-execution-ports";
import type { ReviewExecution } from "../../domain/review-execution";
type Transaction = Prisma.TransactionClient;

/** Host-owned input validity, evaluated inside the lease transaction before budget charge.
 * Exact retries of an already granted lease restore their immutable input.
 */
export type ReviewExecutionInputAdmissionPort = Readonly<{
  lock(
    transaction: Transaction,
    command: AcquireReviewInvocationLeaseCommand,
  ): Promise<void>;
  admit(
    transaction: Transaction,
    input: Readonly<{
      command: AcquireReviewInvocationLeaseCommand;
      execution: ReviewExecution;
      now: Date;
    }>,
  ): Promise<boolean>;
}>;
