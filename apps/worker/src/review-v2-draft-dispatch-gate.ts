import type { ReviewRequestedIntent } from "@reviewrouter/features-review-executions";
import {
  ReviewRequestEligibilityStatus,
  type ReviewRequestEligibilityPort,
} from "./review-v2-request-ingress-handler";

export type DraftDispatchRepository = Readonly<{
  workspaceId: string;
  fullName: string;
  githubInstallationId: string;
}>;

export type DraftDispatchGateDependencies = Readonly<{
  reviewDrafts(workspaceId: string): Promise<boolean>;
  /** Returns null when the connection is gone or has no GitHub installation. */
  findGitHubRepository(
    repositoryConnectionId: string,
  ): Promise<DraftDispatchRepository | null>;
  eligibility: ReviewRequestEligibilityPort;
}>;

/**
 * Re-checks a queued intent right before dispatch so disabling workspace draft
 * review also stops already queued draft reviews. Workspaces that review drafts
 * dispatch without a GitHub read. Otherwise only a current non-draft pull
 * request may proceed; unavailable eligibility throws so the claim is retried
 * instead of cancelling the intent.
 */
export function createWorkspaceDraftDispatchGate(
  dependencies: DraftDispatchGateDependencies,
): (
  intent: Pick<
    ReviewRequestedIntent,
    "workspaceId" | "repositoryConnectionId" | "pullRequestNumber"
  >,
  signal?: AbortSignal,
) => Promise<boolean> {
  return async (intent, signal) => {
    if (await dependencies.reviewDrafts(intent.workspaceId)) return true;
    signal?.throwIfAborted();
    const repository = await dependencies.findGitHubRepository(
      intent.repositoryConnectionId,
    );
    if (!repository || repository.workspaceId !== intent.workspaceId)
      return false;
    signal?.throwIfAborted();
    const current = await dependencies.eligibility.load({
      githubInstallationId: repository.githubInstallationId,
      repositoryFullName: repository.fullName,
      pullRequestNumber: intent.pullRequestNumber,
      ...(signal ? { signal } : {}),
    });
    if (current.status === ReviewRequestEligibilityStatus.Unavailable) {
      throw new Error("review_request_eligibility_unavailable");
    }
    return (
      current.status === ReviewRequestEligibilityStatus.Current &&
      !current.draft
    );
  };
}
