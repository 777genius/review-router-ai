import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { buildClaimedReviewProgress } from "./review-progress-claim-eligibility-policy";
import type {
  ClaimedReviewProgress,
  PrismaReviewProgressPublicationStore,
} from "./review-progress-store";

/** Select one due publication scope under the existing row lock and priority policy. */
export async function selectDuePublicationScope(
  transaction: Prisma.TransactionClient,
  now: Date,
  repositoryPredicate: Prisma.Sql,
): Promise<ClaimedReviewProgress["scope"] | null> {
  const rows = await transaction.$queryRaw<
    Array<ClaimedReviewProgress["scope"]>
  >(Prisma.sql`
  SELECT publication."workspaceId", publication."repositoryConnectionId",
    publication."scmRepositoryIdentityId", publication."pullRequestNumber"
  FROM "ReviewProgressPublicationV1" publication
  WHERE publication."desiredVersion" > publication."publishedVersion"
    AND publication."nextPublishAt" <= ${now}
    AND (publication."claimUntil" IS NULL OR publication."claimUntil" <= ${now})
    ${repositoryPredicate}
  ORDER BY
    CASE WHEN EXISTS (
      SELECT 1 FROM "ReviewExecutionProgressV1" progress
      WHERE progress."executionId" = publication."activeExecutionId"
        AND progress."terminalOutcome" IS NOT NULL
    ) THEN 0 ELSE 1 END,
    publication."nextPublishAt", publication."updatedAt"
  LIMIT 1
  FOR UPDATE SKIP LOCKED
`);
  return rows[0] ?? null;
}

/** Persist the fenced claim and construct its owned publication projection. */
export async function claimPreparedPublication(
  transaction: Prisma.TransactionClient,
  input: Parameters<PrismaReviewProgressPublicationStore["claimNext"]>[0],
  candidate: ClaimedReviewProgress["scope"],
  publication: {
    readonly publishedVersion: bigint;
    readonly commentId: bigint | null;
    readonly publishedBodyHash: string | null;
    readonly failureCount: number;
  },
  progress: {
    readonly executionId: string;
    readonly generation: bigint;
    readonly headSha: string;
    readonly planHash: string;
    readonly desiredVersion: bigint;
    readonly snapshotJson: unknown;
    readonly terminalOutcome: string | null;
  },
  repository: {
    readonly owner: string;
    readonly name: string;
  },
  installation: { readonly githubInstallationId: bigint },
): Promise<ClaimedReviewProgress> {
  const claimId = randomUUID();
  const claimUntil = new Date(input.now.getTime() + input.claimDurationMs);
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        candidate,
    },
    data: { claimId, claimOwnerIdHash: input.ownerIdHash, claimUntil },
  });
  return buildClaimedReviewProgress({
    candidate,
    publication,
    progress,
    repository,
    installation,
    claim: { claimId, ownerIdHash: input.ownerIdHash, claimUntil },
  });
}
