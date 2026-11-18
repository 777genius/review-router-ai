import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ClaimedReviewProgress } from "./review-progress-store";

/** Persist a scoped requeue if an older GitHub PATCH may have landed. */
export async function requeuePublishedScopeAfterClaimLoss(
  prisma: PrismaClient,
  scope: ClaimedReviewProgress["scope"],
  now: Date,
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
            "lastErrorCode" = ${repairMarker},
            "nextPublishAt" = ${now},
            "updatedAt" = ${now}
        WHERE "workspaceId" = ${scope.workspaceId}
          AND "repositoryConnectionId" = ${scope.repositoryConnectionId}
          AND "scmRepositoryIdentityId" = ${scope.scmRepositoryIdentityId}
          AND "pullRequestNumber" = ${scope.pullRequestNumber}
      `;
  try {
    await prisma.$executeRaw(repairSql);
  } catch (error) {
    if (!isSerializableRepairConflict(error)) throw error;
    await prisma.$executeRaw(repairSql);
  }
}

function isSerializableRepairConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  if (typeof meta !== "object" || meta === null) return false;

  // Prisma adapter-pg may wrap a PostgreSQL SQLSTATE as a raw-query P2010.
  const adapter = "driverAdapterError" in meta ? meta.driverAdapterError : null;
  const cause =
    typeof adapter === "object" && adapter !== null && "cause" in adapter
      ? adapter.cause
      : null;
  const directCode = "code" in meta ? meta.code : undefined;
  const adapterCode =
    typeof cause === "object" && cause !== null && "originalCode" in cause
      ? cause.originalCode
      : undefined;
  return (
    directCode === "40001" ||
    directCode === "40P01" ||
    adapterCode === "40001" ||
    adapterCode === "40P01"
  );
}
