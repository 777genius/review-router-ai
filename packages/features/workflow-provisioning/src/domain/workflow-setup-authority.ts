/**
 * Compare the observed setup attempt and installation against the current
 * durable state. This is an authorization/recovery precondition, not a
 * substitute for the storage adapter's atomic compare-and-swap settlement.
 */
type ObservedSetupAttempt = Readonly<{
  attemptId: string;
  revision: number | bigint;
  pullRequestHeadSha: string | null;
  branch: string | null;
  pullRequestUrl: string | null;
}>;

type CurrentSetupAttempt = ObservedSetupAttempt &
  Readonly<{
    workspaceId: string;
    installationId: string | null;
    workflowPath: string;
    workflowStyle: string;
    actionVersion: string;
  }>;

export function isCurrentWorkflowSetupAuthority(input: {
  readonly observedRepositoryDefaultBranch: string | null | undefined;
  readonly expectedBaseBranch: string;
  readonly expectedAttempt: ObservedSetupAttempt | null;
  readonly currentAttempt: CurrentSetupAttempt | null;
  readonly workspaceId: string;
  readonly installationId: string | null;
  readonly historicalMergedSetupPullRequest: boolean;
  readonly verifiedArtifact: Readonly<{
    workflowPath: string;
    workflowStyle: string;
    actionVersion: string;
  }>;
}): boolean {
  if (input.observedRepositoryDefaultBranch !== input.expectedBaseBranch) {
    return false;
  }
  const expected = input.expectedAttempt;
  const current = input.currentAttempt;
  if (expected === null) return current === null;
  if (
    !current ||
    current.workspaceId !== input.workspaceId ||
    current.installationId !== input.installationId ||
    current.attemptId !== expected.attemptId ||
    current.revision !== expected.revision ||
    current.pullRequestHeadSha !== expected.pullRequestHeadSha ||
    current.branch !== expected.branch ||
    current.pullRequestUrl !== expected.pullRequestUrl
  ) {
    return false;
  }
  if (
    (input.historicalMergedSetupPullRequest ||
      expected.pullRequestHeadSha !== null) &&
    (current.workflowPath !== input.verifiedArtifact.workflowPath ||
      current.workflowStyle !== input.verifiedArtifact.workflowStyle ||
      current.actionVersion !== input.verifiedArtifact.actionVersion)
  ) {
    return false;
  }
  return true;
}
