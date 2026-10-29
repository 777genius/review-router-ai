import { Prisma, type PrismaClient } from "@prisma/client";
import type { HistoryProjector } from "../../application/ports/history-projector";
import {
  HistoryCollisionError,
  parseHistoryChangedEvent,
  type HistoryChangedEvent,
} from "../../domain/history-events";
import {
  applyHistorySnapshot,
  eventSnapshots,
  historyStatus,
  type HistoryProjectionState,
  type HistorySourceCursor,
} from "../../domain/status-policy";
import { historyHash } from "./history-hash";
export function createPrismaHistoryProjector(
  prisma: PrismaClient,
): HistoryProjector {
  return {
    async project(input: HistoryChangedEvent) {
      const event = parseHistoryChangedEvent(input);
      return prisma.$transaction(async (tx) => {
        // Immutable lookup identifies the PR before taking locks in PR -> Run order.
        const immutable = await tx.reviewHistoryRun.findUnique({
          where: { rootRequestId: event.run.rootRequestId },
        });
        if (!immutable) return "ignored";
        await tx.$queryRaw`SELECT "id" FROM "ReviewHistoryPullRequest" WHERE "id"=${immutable.pullRequestId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "rootRequestId" FROM "ReviewHistoryRun" WHERE "rootRequestId"=${immutable.rootRequestId} FOR UPDATE`;
        const row = await tx.reviewHistoryRun.findUniqueOrThrow({
          where: { rootRequestId: immutable.rootRequestId },
        });
        const expected = {
          rootRequestId: row.rootRequestId,
          pullRequestId: row.pullRequestId,
          workspaceId: row.workspaceId,
          scmRepositoryIdentityId: row.scmRepositoryIdentityId,
          pullRequestNumber: row.pullRequestNumber,
          originalRepositoryConnectionId: row.originalRepositoryConnectionId,
          runSequence: row.runSequence.toString(),
          requestedAt: row.requestedAt.toISOString(),
          triggerKind: row.triggerKind,
          headSha: row.headSha,
          reviewRevisionHash: row.reviewRevisionHash,
          repositoryFullName: row.repositoryFullName,
          pullRequestTitle: row.pullRequestTitle,
          sourceBaseUrl: row.sourceBaseUrl,
        };
        if (historyHash(expected) !== historyHash(event.run))
          throw new HistoryCollisionError();
        const before: HistoryProjectionState = {
          selectedDispatchAttempt: row.selectedDispatchAttempt,
          intentCursor: row.intentCursor as HistorySourceCursor | null,
          executionCursor: row.executionCursor as HistorySourceCursor | null,
          completionCursor: row.completionCursor as HistorySourceCursor | null,
        };
        let next = before;
        for (const snapshot of eventSnapshots(event))
          next = applyHistorySnapshot(
            next,
            snapshot,
            historyHash(snapshot),
            row,
          );
        if (next === before) return "duplicate";
        const status = historyStatus(next),
          now = new Date();
        await tx.reviewHistoryRun.update({
          where: { rootRequestId: row.rootRequestId },
          data: {
            selectedDispatchAttempt: next.selectedDispatchAttempt,
            intentCursor:
              (next.intentCursor as unknown as Prisma.InputJsonValue) ??
              Prisma.DbNull,
            executionCursor:
              (next.executionCursor as unknown as Prisma.InputJsonValue) ??
              Prisma.DbNull,
            completionCursor:
              (next.completionCursor as unknown as Prisma.InputJsonValue) ??
              Prisma.DbNull,
            status,
            projectedAt: row.projectedAt ?? now,
            updatedAt: now,
          },
        });
        await tx.$executeRaw`UPDATE "ReviewHistoryPullRequest" SET "latestRootRequestId"=${row.rootRequestId},"latestRunSequence"=${row.runSequence},"latestRequestedAt"=${row.requestedAt},"latestStatus"=${status},"repositoryFullName"=${row.repositoryFullName},"pullRequestTitle"=${row.pullRequestTitle},"sourceBaseUrl"=${row.sourceBaseUrl},"projectedAt"=${now} WHERE "id"=${row.pullRequestId} AND ("latestRunSequence" IS NULL OR "latestRunSequence"<=${row.runSequence})`;
        return "applied";
      });
    },
  };
}
