/**
 * What a pull request author sees when hosted admission refuses a review
 * because the pull request is over the changed-line ceiling. The refusal
 * itself stays in the admission gate; this only explains it on the PR.
 */
export const reviewSizeLimitNoticeMarker =
  "<!-- reviewrouter:size-limit-notice:v1 -->";

export type ReviewSizeLimitNotice = {
  readonly githubInstallationId: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly changedLines: number;
  readonly maxChangedLines: number;
};

export interface ReviewSizeLimitNoticePort {
  /** Creates or rewrites the one size-limit comment of the pull request. */
  publish(notice: ReviewSizeLimitNotice): Promise<void>;
}

export function renderReviewSizeLimitNotice(
  notice: Pick<
    ReviewSizeLimitNotice,
    "headSha" | "changedLines" | "maxChangedLines"
  >,
): string {
  const lines = (value: number) => value.toLocaleString("en-US");
  return [
    "**ReviewRouter did not review this pull request: it is larger than the review limit.**",
    "",
    `It changes ${lines(notice.changedLines)} lines (additions plus deletions) and the limit is ${lines(notice.maxChangedLines)}, so no AI review was started. The failed ReviewRouter run on this pull request is this limit, not a problem in the code.`,
    "",
    "To get a review, split the change into smaller pull requests. The limit is set on the ReviewRouter server, not in the repository: on hosted ReviewRouter contact the ReviewRouter team, on a self-hosted install your operator can raise `REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES`.",
    "",
    `Checked commit \`${notice.headSha.slice(0, 12)}\`.`,
    "",
    reviewSizeLimitNoticeMarker,
  ].join("\n");
}
