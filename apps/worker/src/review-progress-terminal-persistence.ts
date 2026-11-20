import { createHash } from "node:crypto";
import {
  ReviewProgressPhaseV1,
  ReviewPublicationAttemptStateV2,
  ReviewPublicationOperationStateV2,
  ReviewPublicationTerminalOutcomeV2,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  publishedSummaryIncomplete,
  ReviewPublicationProjectionCoverage,
} from "@reviewrouter/features-review-publishing/v2";
import {
  executionStateTerminal,
  terminalSnapshot,
  type TerminalOutcome,
} from "./review-progress-terminal-policy";
import type { ClaimedReviewProgress } from "./review-progress-store";
import { retryOnSerializationConflict } from "./review-progress-transaction-retry";

/** Read and fence the active progress generation before terminal promotion. */
async function loadPromotableProgress(
  transaction: Prisma.TransactionClient,
  executionId: string,
) {
  const progress = await transaction.reviewExecutionProgressV1.findUnique({
    where: { executionId },
  });
  if (!progress || progress.terminalOutcome !== null) return null;
  const scope = {
    workspaceId: progress.workspaceId,
    repositoryConnectionId: progress.repositoryConnectionId,
    scmRepositoryIdentityId: progress.scmRepositoryIdentityId,
    pullRequestNumber: progress.pullRequestNumber,
  };
  const publication = await transaction.reviewProgressPublicationV1.findUnique({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        scope,
    },
  });
  if (
    !publication ||
    publication.activeExecutionId !== executionId ||
    publication.activeGeneration !== progress.generation ||
    publication.activeHeadSha !== progress.headSha ||
    publication.activePlanHash !== progress.planHash
  )
    return null;
  return { progress, scope, publication };
}

/** Trust the current durable attempt, not an individual operation's hint. */
async function durableSettledPublicationOutcome(
  transaction: Prisma.TransactionClient,
  executionId: string,
  progress: { readonly generation: bigint; readonly headSha: string },
): Promise<"succeeded" | "failed" | "superseded" | null> {
  const process = await transaction.reviewCompletionProcess.findUnique({
    where: { executionId },
    select: { publicationAttemptId: true },
  });
  if (!process?.publicationAttemptId) return null;
  const attempt = await transaction.reviewPublicationAttemptV2.findUnique({
    where: { publicationAttemptId: process.publicationAttemptId },
    select: {
      executionId: true,
      generation: true,
      reviewedHeadSha: true,
      state: true,
      terminalOutcome: true,
    },
  });
  if (
    !attempt ||
    attempt.executionId !== executionId ||
    attempt.generation !== progress.generation ||
    attempt.reviewedHeadSha !== progress.headSha ||
    attempt.state !== ReviewPublicationAttemptStateV2.terminal
  )
    return null;

  // The publisher can settle one due operation while required siblings remain
  // deferred. Read the durable attempt/operation states under this transaction.
  const settledStates =
    attempt.terminalOutcome === ReviewPublicationTerminalOutcomeV2.succeeded
      ? [ReviewPublicationOperationStateV2.completed]
      : [
          ReviewPublicationOperationStateV2.completed,
          ReviewPublicationOperationStateV2.superseded_no_effect,
          ReviewPublicationOperationStateV2.failed_no_effect,
          ReviewPublicationOperationStateV2.stale_compensated,
          ReviewPublicationOperationStateV2.stale_visible,
        ];
  const pendingRequired = await transaction.reviewPublicationOperationV2.count({
    where: {
      publicationAttemptId: process.publicationAttemptId,
      required: true,
      state: { notIn: settledStates },
    },
  });
  if (pendingRequired !== 0) return null;

  switch (attempt.terminalOutcome) {
    case ReviewPublicationTerminalOutcomeV2.succeeded:
      return "succeeded";
    case ReviewPublicationTerminalOutcomeV2.superseded_no_effect:
    case ReviewPublicationTerminalOutcomeV2.stale_compensated:
      return "superseded";
    case ReviewPublicationTerminalOutcomeV2.failed_no_effect:
    case ReviewPublicationTerminalOutcomeV2.stale_visible:
      return "failed";
    default:
      // terminal_unknown cannot make progress terminal.
      return null;
  }
}

/**
 * The verdict of the summary that was published for this generation: the same
 * "Review incomplete" or not that the pull request shows. Null when the
 * finalized artifact does not belong to this progress generation.
 */
async function publishedSummaryVerdict(
  transaction: Prisma.TransactionClient,
  executionId: string,
  progress: { readonly generation: bigint; readonly headSha: string },
): Promise<"complete" | "incomplete" | null> {
  const artifact =
    await transaction.finalizedReviewProjectionArtifactV2.findUnique({
      where: { executionId },
      select: {
        generation: true,
        reviewedHeadSha: true,
        coverageState: true,
        projectionEnvelope: true,
      },
    });
  if (
    !artifact ||
    artifact.generation !== progress.generation ||
    artifact.reviewedHeadSha !== progress.headSha
  )
    return null;
  return publishedSummaryIncomplete({
    coverage:
      artifact.coverageState === "partial"
        ? ReviewPublicationProjectionCoverage.Partial
        : ReviewPublicationProjectionCoverage.Completed,
    sourceSummaryBody: sourceSummaryBody(artifact.projectionEnvelope),
  })
    ? "incomplete"
    : "complete";
}

function sourceSummaryBody(envelope: Prisma.JsonValue): string {
  const publishing = isJsonObject(envelope) ? envelope.publishing : null;
  const summary = isJsonObject(publishing) ? publishing.summary : null;
  const body = isJsonObject(summary) ? summary.body : null;
  return typeof body === "string" ? body : "";
}

function isJsonObject(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Promote only a fully settled current attempt that still owns progress. */
async function promoteSettledExecution(
  transaction: Prisma.TransactionClient,
  executionId: string,
  now: Date,
): Promise<boolean> {
  const execution = await transaction.reviewExecutionV2.findUnique({
    where: { executionId },
    select: { executionId: true, state: true },
  });
  if (!execution) return false;
  const promotable = await loadPromotableProgress(transaction, executionId);
  if (!promotable) return false;
  const publicationOutcome = await durableSettledPublicationOutcome(
    transaction,
    executionId,
    promotable.progress,
  );
  if (!publicationOutcome) return false;
  // Only a completed, published review can still end either way; every other
  // outcome is decided without reading the projection.
  const summaryVerdict =
    publicationOutcome === "succeeded" && execution.state === "completed"
      ? await publishedSummaryVerdict(
          transaction,
          executionId,
          promotable.progress,
        )
      : "complete";
  if (summaryVerdict === null) return false;
  const terminalOutcome = executionStateTerminal(
    execution.state,
    publicationOutcome,
    summaryVerdict,
  );
  if (!terminalOutcome) return false;
  await persistTerminalPromotion(transaction, {
    executionId,
    scope: promotable.scope,
    desiredVersion: promotable.publication.desiredVersion + 1n,
    snapshot: terminalSnapshot(
      promotable.progress.snapshotJson,
      terminalOutcome,
      now,
      // Every required part was covered on the server, also when the summary
      // says incomplete; the comment then counts only the parts it needed.
      { requiredCoverageComplete: execution.state === "completed" },
    ),
    terminalOutcome,
    now,
  });
  return true;
}

export type SettledExecutionInput = {
  /** Candidates only: each promotion rereads the durable settlement. */
  readonly executionIds: readonly string[];
  readonly now: Date;
};

/** Process independent terminal promotions without dropping later failures. */
export async function promoteSettledExecutions(
  prisma: PrismaClient,
  input: SettledExecutionInput,
): Promise<number> {
  let promoted = 0;
  const failures: unknown[] = [];
  for (const executionId of new Set(input.executionIds)) {
    try {
      // Promotion is idempotent: a rerun after a conflict rereads the progress
      // row and stops once another worker made it terminal.
      const changed = await retryOnSerializationConflict(() =>
        prisma.$transaction(
          (transaction) =>
            promoteSettledExecution(transaction, executionId, input.now),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
      if (changed) promoted += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "review_progress_settlements_failed");
  }
  return promoted;
}

/** Keyset position of the promotion sweep over publication scopes. */
export type PromotionScanCursor = ClaimedReviewProgress["scope"];

/**
 * Read one bounded page of publication scopes in key order and return the
 * active executions whose posted comment still waits at "assembling".
 * Promotion rechecks every candidate, so this read only has to be a superset.
 *
 * A scope without a posted comment is skipped: nothing on GitHub is stuck, and
 * promoting it would post a new comment on a PR whose review ended long ago
 * (for example rows closed by the operator's backlog expiry).
 */
export async function scanPromotionCandidates(
  prisma: PrismaClient,
  input: {
    readonly after: PromotionScanCursor | null;
    readonly limit: number;
  },
): Promise<{
  readonly executionIds: readonly string[];
  readonly nextCursor: PromotionScanCursor | null;
}> {
  const page = await prisma.reviewProgressPublicationV1.findMany({
    ...(input.after
      ? {
          cursor: {
            workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
              input.after,
          },
          skip: 1,
        }
      : {}),
    orderBy: [
      { workspaceId: "asc" },
      { repositoryConnectionId: "asc" },
      { scmRepositoryIdentityId: "asc" },
      { pullRequestNumber: "asc" },
    ],
    take: input.limit,
    select: {
      workspaceId: true,
      repositoryConnectionId: true,
      scmRepositoryIdentityId: true,
      pullRequestNumber: true,
      activeExecutionId: true,
      commentId: true,
    },
  });
  const last = page.at(-1);
  const nextCursor =
    last && page.length === input.limit
      ? {
          workspaceId: last.workspaceId,
          repositoryConnectionId: last.repositoryConnectionId,
          scmRepositoryIdentityId: last.scmRepositoryIdentityId,
          pullRequestNumber: last.pullRequestNumber,
        }
      : null;
  // Filter after the keyed read so one pass reads each scope exactly once.
  const posted = page.filter(({ commentId }) => commentId !== null);
  if (posted.length === 0) return { executionIds: [], nextCursor };
  const assembling = await prisma.reviewExecutionProgressV1.findMany({
    where: {
      executionId: { in: posted.map((scope) => scope.activeExecutionId) },
      phase: ReviewProgressPhaseV1.assembling,
      terminalOutcome: null,
    },
    orderBy: { executionId: "asc" },
    select: { executionId: true },
  });
  return {
    executionIds: assembling.map(({ executionId }) => executionId),
    nextCursor,
  };
}

/** Write a terminal snapshot and its publication version in one transaction. */
async function persistTerminalPromotion(
  transaction: Prisma.TransactionClient,
  input: {
    readonly executionId: string;
    readonly scope: ClaimedReviewProgress["scope"];
    readonly desiredVersion: bigint;
    readonly snapshot: Prisma.InputJsonObject;
    readonly terminalOutcome: TerminalOutcome;
    readonly now: Date;
  },
): Promise<void> {
  await persistTerminalExecutionProgress(transaction, input);
  await persistTerminalPublicationSchedule(transaction, input);
}

/** Persist terminal progress first, retaining the enclosing transaction. */
async function persistTerminalExecutionProgress(
  transaction: Prisma.TransactionClient,
  input: Parameters<typeof persistTerminalPromotion>[1],
): Promise<void> {
  const snapshotHash = hashProgressSnapshot(input.snapshot);
  await transaction.reviewExecutionProgressV1.update({
    where: { executionId: input.executionId },
    data: {
      phase: "terminal",
      terminalOutcome: input.terminalOutcome,
      snapshotJson: input.snapshot,
      snapshotHash,
      desiredVersion: input.desiredVersion,
      updatedAt: input.now,
    },
  });
}

/** Schedule the terminal publication after its progress snapshot is stored. */
async function persistTerminalPublicationSchedule(
  transaction: Prisma.TransactionClient,
  input: Parameters<typeof persistTerminalPromotion>[1],
): Promise<void> {
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        input.scope,
    },
    data: {
      version: { increment: 1n },
      desiredVersion: input.desiredVersion,
      nextPublishAt: input.now,
      // A new version must not inherit the previous version's error budget.
      failureCount: 0,
      lastErrorCode: null,
      updatedAt: input.now,
      // Preserve a live claim. Its completion is fenced by desiredVersion,
      // while clearing it here could allow two simultaneous GitHub writes.
    },
  });
}

function hashProgressSnapshot(value: Prisma.InputJsonObject): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}
