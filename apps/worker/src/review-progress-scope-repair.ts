import { Prisma, type PrismaClient } from "@prisma/client";
import type { ClaimedReviewProgress } from "./review-progress-store";

/** Persist a scoped requeue if an older GitHub PATCH may have landed. */
export async function requeuePublishedScopeAfterClaimLoss(
  prisma: PrismaClient,
  scope: ClaimedReviewProgress["scope"],
  now: Date,
): Promise<void> {
  // Requeue without changing desiredVersion, invalidating any active claim
  // so a delayed settlement cannot silently erase the repair.
  const repairSql = Prisma.sql`
        UPDATE "ReviewProgressPublicationV1"
        SET "publishedVersion" = CASE
              WHEN "publishedVersion" = "desiredVersion"
                AND "publishedVersion" > 0
              THEN "publishedVersion" - 1
              ELSE "publishedVersion"
            END,
            "claimId" = NULL,
            "claimOwnerIdHash" = NULL,
            "claimUntil" = NULL,
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
