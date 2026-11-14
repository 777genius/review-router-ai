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

/** Project an already-fenced publication into its immutable worker claim. */
export function buildClaimedReviewProgress(input: {
  readonly candidate: ClaimedReviewProgress["scope"];
  readonly publication: Pick<
    ClaimedReviewProgress,
    "publishedVersion" | "commentId" | "publishedBodyHash" | "failureCount"
  >;
  readonly progress: Pick<
    ClaimedReviewProgress,
    "executionId" | "generation" | "headSha" | "planHash" | "desiredVersion"
  > & {
    readonly snapshotJson: unknown;
    readonly terminalOutcome: string | null;
  };
  readonly repository: Pick<
    ClaimedReviewProgress["repository"],
    "owner" | "name"
  >;
  readonly installation: Pick<
    ClaimedReviewProgress["repository"],
    "githubInstallationId"
  >;
  readonly claim: ClaimedReviewProgress["claim"];
}): ClaimedReviewProgress {
  const { candidate, publication, progress, repository, installation, claim } =
    input;
  return {
    scope: candidate,
    executionId: progress.executionId,
    generation: progress.generation,
    headSha: progress.headSha,
    planHash: progress.planHash,
    desiredVersion: progress.desiredVersion,
    publishedVersion: publication.publishedVersion,
    commentId: publication.commentId,
    publishedBodyHash: publication.publishedBodyHash,
    failureCount: publication.failureCount,
    snapshot: progress.snapshotJson,
    terminal: progress.terminalOutcome !== null,
    repository: {
      owner: repository.owner,
      name: repository.name,
      githubInstallationId: installation.githubInstallationId,
    },
    claim,
  };
}
