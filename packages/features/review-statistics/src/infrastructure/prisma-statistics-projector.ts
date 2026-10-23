import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ReviewStatisticsProjectionStatus,
  type ReviewStatisticsProjector,
} from "../application/ports";
import {
  StatisticsCollisionError,
  type ReviewStatisticsSettledEvent,
} from "../domain/statistics";
import { normalizeStatisticsEvent } from "../domain/statistics-policy";
import { statisticsEventHash, statisticsIssueId } from "./statistics-hash";
export class PrismaReviewStatisticsProjector implements ReviewStatisticsProjector {
  constructor(private readonly prisma: PrismaClient) {}
  async project(
    input: ReviewStatisticsSettledEvent,
  ): Promise<ReviewStatisticsProjectionStatus> {
    const event = normalizeStatisticsEvent(input),
      hash = statisticsEventHash(event);
    return this.prisma.$transaction(async (tx) => {
      const repository = await tx.$queryRaw<
        { id: string; scmRepositoryIdentityId: string | null }[]
      >`SELECT "id", "scmRepositoryIdentityId" FROM "RepositoryConnection" WHERE "id"=${event.repositoryConnectionId} AND "workspaceId"=${event.workspaceId} FOR SHARE`;
      if (!repository[0]) {
        const exists = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "RepositoryConnection" WHERE "id"=${event.repositoryConnectionId}`;
        if (exists[0]) throw new StatisticsCollisionError();
        return ReviewStatisticsProjectionStatus.DeletedRepository;
      }
      if (
        repository[0].scmRepositoryIdentityId !== event.scmRepositoryIdentityId
      )
        throw new StatisticsCollisionError();
      const inserted =
        await tx.$executeRaw`INSERT INTO "ReviewStatisticsReviewFact" ("executionId","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","settledAt","payloadHash") VALUES (${event.executionId},${event.workspaceId},${event.repositoryConnectionId},${event.scmRepositoryIdentityId},${event.pullRequestNumber},${new Date(event.settledAt)},${hash}) ON CONFLICT ("executionId") DO NOTHING`;
      if (!inserted) {
        const rows = await tx.$queryRaw<
          { payloadHash: string }[]
        >`SELECT "payloadHash" FROM "ReviewStatisticsReviewFact" WHERE "executionId"=${event.executionId}`;
        if (rows[0]?.payloadHash !== hash) throw new StatisticsCollisionError();
        return ReviewStatisticsProjectionStatus.Duplicate;
      }
      if (event.issues.length) {
        const rows = event.issues.map(
          (issue) =>
            Prisma.sql`(${statisticsIssueId(event, issue.lineageId)},${event.workspaceId},${event.repositoryConnectionId},${event.scmRepositoryIdentityId},${event.pullRequestNumber},${issue.lineageId},${issue.severity},${issue.title},${new Date(event.settledAt)},${event.executionId})`,
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "ReviewStatisticsIssueFact" ("id","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","lineageId","severity","title","caughtAt","sourceExecutionId") VALUES ${Prisma.join(rows)} ON CONFLICT ("workspaceId","scmRepositoryIdentityId","pullRequestNumber","lineageId") DO UPDATE SET "caughtAt"=EXCLUDED."caughtAt","sourceExecutionId"=EXCLUDED."sourceExecutionId","severity"=EXCLUDED."severity","title"=EXCLUDED."title" WHERE (EXCLUDED."caughtAt",EXCLUDED."sourceExecutionId") < ("ReviewStatisticsIssueFact"."caughtAt","ReviewStatisticsIssueFact"."sourceExecutionId")`,
        );
      }
      return ReviewStatisticsProjectionStatus.Applied;
    });
  }
}
