import type { ClaimedReviewProgress } from "./review-progress-store";

/** Validate a candidate against the exact active progress generation. */
export function matchesActiveProgressIdentity(
  progress: {
    readonly generation: bigint;
    readonly headSha: string;
    readonly planHash: string;
    readonly desiredVersion: bigint;
  },
  publication: {
    readonly activeGeneration: bigint;
    readonly activeHeadSha: string;
    readonly activePlanHash: string;
    readonly desiredVersion: bigint;
  },
): boolean {
  return (
    progress.generation === publication.activeGeneration &&
    progress.headSha === publication.activeHeadSha &&
    progress.planHash === publication.activePlanHash &&
    progress.desiredVersion === publication.desiredVersion
  );
}

/** Keep GitHub repository eligibility separate from the claim write. */
export function isPublishableGitHubRepository(
  repository: {
    readonly workspaceId: string;
    readonly scmRepositoryIdentityId: string | null;
    readonly selected: boolean;
    readonly archived: boolean;
    readonly provider: string;
  },
  installationStatus: string,
  publication: {
    readonly workspaceId: string;
    readonly scmRepositoryIdentityId: string;
  },
): boolean {
  return (
    repository.workspaceId === publication.workspaceId &&
    repository.scmRepositoryIdentityId ===
      publication.scmRepositoryIdentityId &&
    installationStatus === "active" &&
    repository.selected === true &&
    repository.archived === false &&
    repository.provider === "github"
  );
}

/** Keep the optimistic claim fence identical across progress mutations. */
export function claimedPublicationFence(publication: ClaimedReviewProgress) {
  return {
    ...publication.scope,
    activeExecutionId: publication.executionId,
    activeGeneration: publication.generation,
    activeHeadSha: publication.headSha,
    activePlanHash: publication.planHash,
    desiredVersion: publication.desiredVersion,
    claimId: publication.claim.claimId,
    claimOwnerIdHash: publication.claim.ownerIdHash,
  };
}

