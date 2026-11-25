/**
 * PR merge observation is evidence, never the authority for installed
 * workflow activation. Historical/changed heads are verified independently
 * against the installed artifact and persisted attempt CAS by the caller.
 */
export function classifySetupPullRequestHead(input: {
  readonly persistedHeadSha: string | null | undefined;
  readonly inspection: Readonly<{
    status: string;
    merged: boolean;
    headSha: string | null;
  }> | null;
}): Readonly<{
  historicalMergedSetupPullRequest: boolean;
  setupPullRequestMerged: boolean;
}> {
  const setupPullRequestStatus = input.inspection?.status ?? null;
  const historicalMergedSetupPullRequest =
    input.inspection?.merged === true &&
    (input.persistedHeadSha === null ||
      (setupPullRequestStatus === "merged" &&
        input.persistedHeadSha !== input.inspection.headSha));
  const setupPullRequestMerged =
    setupPullRequestStatus === "merged" &&
    input.persistedHeadSha != null &&
    input.persistedHeadSha === input.inspection?.headSha;
  return { historicalMergedSetupPullRequest, setupPullRequestMerged };
}
