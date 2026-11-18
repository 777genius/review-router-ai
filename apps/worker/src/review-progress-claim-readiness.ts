import type { Prisma } from "@prisma/client";
import {
  isPublishableGitHubRepository,
  matchesActiveProgressIdentity,
} from "./review-progress-claim-eligibility-policy";
import type { ClaimedReviewProgress } from "./review-progress-store";

/** Resolve active progress and defer an invalid generation before repository lookup. */
export async function loadMatchingActiveProgress(
  transaction: Prisma.TransactionClient,
  publication: {
    readonly activeExecutionId: string;
    readonly activeGeneration: bigint;
    readonly activeHeadSha: string;
    readonly activePlanHash: string;
    readonly desiredVersion: bigint;
  },
  scope: ClaimedReviewProgress["scope"],
  now: Date,
) {
  const progress = await transaction.reviewExecutionProgressV1.findUnique({
    where: { executionId: publication.activeExecutionId },
  });
  if (!progress || !matchesActiveProgressIdentity(progress, publication)) {
    await deferUnavailablePublication(
      transaction,
      scope,
      now,
      "review_progress_projection_identity_corrupted",
    );
    return null;
  }
  return progress;
}

/** Check GitHub repository eligibility before writing the publication claim. */
export async function loadPublishableGitHubRepository(
  transaction: Prisma.TransactionClient,
  publication: {
    readonly repositoryConnectionId: string;
    readonly workspaceId: string;
    readonly scmRepositoryIdentityId: string;
  },
  scope: ClaimedReviewProgress["scope"],
  now: Date,
) {
  const repository = await transaction.repositoryConnection.findUnique({
    where: { id: publication.repositoryConnectionId },
    include: {
      installation: {
        select: { githubInstallationId: true, status: true },
      },
    },
  });
  if (
    !repository ||
    !repository.installation ||
    !isPublishableGitHubRepository(
      repository,
      repository.installation.status,
      publication,
    )
  ) {
    await deferUnavailablePublication(
      transaction,
      scope,
      now,
      "review_progress_github_repository_unavailable",
    );
    return null;
  }
  return { repository, installation: repository.installation };
}

async function deferUnavailablePublication(
  transaction: Prisma.TransactionClient,
  scope: {
    workspaceId: string;
    repositoryConnectionId: string;
    scmRepositoryIdentityId: string;
    pullRequestNumber: number;
  },
  now: Date,
  code: string,
): Promise<void> {
  await transaction.reviewProgressPublicationV1.update({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        scope,
    },
    data: {
      // An unavailable projection is not a failed publication attempt.
      // Invalidate any expired owner's fence before permitting later retries.
      claimId: null,
      claimOwnerIdHash: null,
      claimUntil: null,
      lastErrorCode: code,
      nextPublishAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    },
  });
}
