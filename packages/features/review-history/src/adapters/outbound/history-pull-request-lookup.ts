import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HistoryValidationError,
  type HistoryPullRequestIdentity,
  type HistoryPullRequestResolution,
  type HistoryPullRequestResolutionInput,
} from "../../domain/history.js";
import { historyIdentifier } from "../../domain/history-filters.js";
import { authorizeHistory } from "./history-read-sql.js";
import {
  HistoryLookupDependencyFailure,
  isHistoryLookupDependencyFailure,
} from "./history-lookup-failure.js";
const isolation = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
} as const;

export async function resolvePrismaHistoryPullRequests(
  prisma: PrismaClient,
  input: HistoryPullRequestResolutionInput,
): Promise<HistoryPullRequestResolution> {
  try {
    return await prisma.$transaction(async (tx) => {
      await authorizeHistory(tx, input.actorId, input.workspaceId);
      if (!Array.isArray(input.pullRequests) || input.pullRequests.length > 25)
        throw new HistoryValidationError("history_invalid_lookup");
      const identities = new Map<string, HistoryPullRequestIdentity>();
      for (const identity of input.pullRequests) {
        if (!identity)
          throw new HistoryValidationError("history_invalid_lookup");
        historyIdentifier(identity.scmRepositoryIdentityId);
        if (
          !Number.isInteger(identity.pullRequestNumber) ||
          identity.pullRequestNumber < 1 ||
          identity.pullRequestNumber > 2_147_483_647
        )
          throw new HistoryValidationError("history_invalid_lookup");
        identities.set(
          JSON.stringify([
            identity.scmRepositoryIdentityId,
            identity.pullRequestNumber,
          ]),
          identity,
        );
      }
      const coverage = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "ReviewHistoryCoverage" WHERE id='capture_v1'`;
      if (!coverage.length || !identities.size)
        return { state: "available" as const, items: [] };
      const tuples = [...identities.values()].map(
        (identity) =>
          Prisma.sql`(${identity.scmRepositoryIdentityId},${identity.pullRequestNumber})`,
      );
      try {
        const items = await tx.$queryRaw<
          (HistoryPullRequestIdentity & { id: string })[]
        >(
          Prisma.sql`SELECT id,"scmRepositoryIdentityId","pullRequestNumber" FROM "ReviewHistoryPullRequest" WHERE "workspaceId"=${input.workspaceId} AND "latestRootRequestId" IS NOT NULL AND "projectedAt" IS NOT NULL AND "latestStatus" IS NOT NULL AND "latestRequestedAt" IS NOT NULL AND ("scmRepositoryIdentityId","pullRequestNumber") IN (${Prisma.join(tuples)}) ORDER BY id`,
        );
        return { state: "available" as const, items };
      } catch (error) {
        if (isHistoryLookupDependencyFailure(error))
          throw new HistoryLookupDependencyFailure();
        throw error;
      }
    }, isolation);
  } catch (error) {
    if (error instanceof HistoryLookupDependencyFailure)
      return { state: "unavailable" };
    throw error;
  }
}
