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
      // Plain read on purpose. The worker role may only SELECT repository
      // connections, and any row lock (FOR SHARE and friends) needs UPDATE
      // privilege, which sent every settled event to the dead letter queue in
      // production. The composite foreign key on the fact insert already blocks
      // a concurrent delete, and the stored identity is checked against this
      // read, so no extra lock is needed.
      const repository = await tx.$queryRaw<
        {
          id: string;
          scmRepositoryIdentityId: string | null;
          provider: string;
          sourceBaseUrl: string;
          externalRepositoryId: string;
        }[]
      >`SELECT "id", "scmRepositoryIdentityId", "provider", "sourceBaseUrl", "externalRepositoryId" FROM "RepositoryConnection" WHERE "id"=${event.repositoryConnectionId} AND "workspaceId"=${event.workspaceId}`;
      if (!repository[0]) {
        const exists = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "RepositoryConnection" WHERE "id"=${event.repositoryConnectionId}`;
        if (exists[0]) throw new StatisticsCollisionError();
        return ReviewStatisticsProjectionStatus.DeletedRepository;
      }
      const original = repository[0];
      if (
        original.scmRepositoryIdentityId !== null &&
        original.scmRepositoryIdentityId !== event.scmRepositoryIdentityId
      )
        throw new StatisticsCollisionError();
      if (original.scmRepositoryIdentityId === null) {
        // Normal unbind clears the live binding but preserves this immutable
        // provider/source/external tuple. Never follow a new current binding.
        const identities = await tx.$queryRaw<
          {
            provider: string;
            normalizedSourceBaseUrl: string;
            externalRepositoryId: string;
          }[]
        >`SELECT "provider", "normalizedSourceBaseUrl", "externalRepositoryId" FROM "ScmRepositoryIdentity" WHERE "scmRepositoryIdentityId"=${event.scmRepositoryIdentityId}`;
        const identity = identities[0];
        if (
          !identity ||
          identity.provider !== original.provider ||
          identity.externalRepositoryId !== original.externalRepositoryId ||
          identity.normalizedSourceBaseUrl !==
            normalizeSourceBaseUrl(original.sourceBaseUrl)
        )
          throw new StatisticsCollisionError();
      }
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
          Prisma.sql`INSERT INTO "ReviewStatisticsIssueFact" ("id","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","lineageId","severity","title","caughtAt","sourceExecutionId") VALUES ${Prisma.join(rows)} ON CONFLICT ("workspaceId","scmRepositoryIdentityId","pullRequestNumber","lineageId") DO UPDATE SET "repositoryConnectionId"=EXCLUDED."repositoryConnectionId","caughtAt"=EXCLUDED."caughtAt","sourceExecutionId"=EXCLUDED."sourceExecutionId","severity"=EXCLUDED."severity","title"=EXCLUDED."title" WHERE (EXCLUDED."caughtAt",EXCLUDED."sourceExecutionId") < ("ReviewStatisticsIssueFact"."caughtAt","ReviewStatisticsIssueFact"."sourceExecutionId")`,
        );
      }
      return ReviewStatisticsProjectionStatus.Applied;
    });
  }
}

/** Matches the canonical registry's HTTPS base URL normalization. */
function normalizeSourceBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}
