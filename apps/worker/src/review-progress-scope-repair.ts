import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ClaimedReviewProgress } from "./review-progress-store";
import { retryOnSerializationConflict } from "./review-progress-transaction-retry";

/** Persist a scoped requeue if an older GitHub PATCH may have landed. */
export async function requeuePublishedScopeAfterClaimLoss(
  prisma: PrismaClient,
  scope: ClaimedReviewProgress["scope"],
  now: Date,
  /** GitHub's retry deadline for the write that triggered the repair. */
  retryAt?: Date,
): Promise<void> {
  // Requeue a potentially stale body without revoking a successor's live
  // claim. PostgreSQL evaluates all SET expressions against the old row.
  // Give each repair a new marker so an in-flight successor cannot settle
  // over a stale GitHub write without losing its own live claim.
  const repairMarker = `review_progress_repair_${randomUUID().replaceAll("-", "")}`;
  const repairSql = Prisma.sql`
        UPDATE "ReviewProgressPublicationV1"
        SET "publishedVersion" = CASE
              WHEN "publishedVersion" = "desiredVersion"
                AND "publishedVersion" > 0
              THEN "publishedVersion" - 1
              ELSE "publishedVersion"
            END,
            "claimId" = CASE
              WHEN "claimUntil" > CURRENT_TIMESTAMP THEN "claimId"
              ELSE NULL
            END,
            "claimOwnerIdHash" = CASE
              WHEN "claimUntil" > CURRENT_TIMESTAMP THEN "claimOwnerIdHash"
              ELSE NULL
            END,
            "claimUntil" = CASE
              WHEN "claimUntil" > CURRENT_TIMESTAMP THEN "claimUntil"
              ELSE NULL
            END,
            -- The repair republishes a body GitHub may no longer show. Failures
            -- of earlier attempts must not suppress it on its first failure.
            "failureCount" = 0,
            "lastErrorCode" = ${repairMarker},
            -- Due at once, or at GitHub's deadline. The installation cooldown
            -- is kept separately in its budget row.
            "nextPublishAt" = ${retryAt ?? now},
            "updatedAt" = ${now}
        WHERE "workspaceId" = ${scope.workspaceId}
          AND "repositoryConnectionId" = ${scope.repositoryConnectionId}
          AND "scmRepositoryIdentityId" = ${scope.scmRepositoryIdentityId}
          AND "pullRequestNumber" = ${scope.pullRequestNumber}
      `;
  await retryOnSerializationConflict(() => prisma.$executeRaw(repairSql));
}
