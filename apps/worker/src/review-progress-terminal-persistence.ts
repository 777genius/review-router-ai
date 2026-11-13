import { createHash } from "node:crypto";
import {
  ReviewPublicationAttemptStateV2,
  ReviewPublicationOperationStateV2,
  ReviewPublicationTerminalOutcomeV2,
  type Prisma,
} from "@prisma/client";
import {
  executionStateTerminal,
  terminalSnapshot,
  type TerminalOutcome,
} from "./review-progress-terminal-policy";
import type { ClaimedReviewProgress } from "./review-progress-store";

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

/** Promote only a fully settled current attempt that still owns progress. */
export async function promoteSettledExecution(
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
  const terminalOutcome = executionStateTerminal(
    execution.state,
    publicationOutcome,
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
    ),
    terminalOutcome,
    now,
  });
  return true;
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
