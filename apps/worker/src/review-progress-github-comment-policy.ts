import { ReviewProgressGitHubError } from "./review-progress-github-error";
import type { UpsertReviewProgressCommentInput } from "./review-progress-github-input-policy";

export const CAPACITY_LIMIT_SCAN = "github_issue_comments_page_limit";

export type ReviewProgressComment = {
  readonly id: number;
  readonly body: string;
  readonly authorLogin: string;
};

/** Confirm a mutation only from the complete observed target-PR comment scan. */
export function confirmedReconciliation(
  observed: readonly ReviewProgressComment[],
  desiredBody: string,
  expectedCommentId?: number,
): ReviewProgressComment[] | null {
  if (
    !observed.some(
      ({ id, body }) =>
        body === desiredBody &&
        (expectedCommentId === undefined || id === expectedCommentId),
    )
  ) {
    return null;
  }
  return [...observed].sort((left, right) => {
    const desiredOrder =
      Number(right.body === desiredBody) - Number(left.body === desiredBody);
    return desiredOrder || left.id - right.id;
  });
}

/** Decide whether a bounded GitHub issue-comment scan is complete. */
export function commentPageScanDecision(
  hasNextPage: boolean | "invalid" | undefined,
  commentsOnPage: number,
  page: number,
  maxPages: number,
): "complete" | "continue" | "inconclusive" {
  // Offset pagination can shift after deletion between requests. A full
  // page at the configured cap is never proof that all comments were seen.
  if (page === maxPages && commentsOnPage === 100) return "inconclusive";
  // Without a complete Link header, a full page is not proof of completion.
  if (
    commentsOnPage < 100 &&
    (hasNextPage === false || hasNextPage === undefined)
  ) {
    return "complete";
  }
  if (hasNextPage === "invalid" || page === maxPages) {
    return "inconclusive";
  }
  return "continue";
}

export {
  commentPageLinks,
  type CommentPageLinks,
} from "./review-progress-github-link-policy";

export function parseCommentOrNull(
  value: unknown,
): ReviewProgressComment | null {
  const row = record(value);
  const user = record(row?.user);
  return row &&
    typeof row.id === "number" &&
    Number.isSafeInteger(row.id) &&
    row.id > 0 &&
    typeof row.body === "string" &&
    typeof user?.login === "string" &&
    user.login.trim().length > 0
    ? { id: row.id as number, body: row.body, authorLogin: user.login }
    : null;
}

export function parseComment(value: unknown): ReviewProgressComment {
  const comment = parseCommentOrNull(value);
  if (!comment)
    throw new ReviewProgressGitHubError(
      "invalid_response",
      "github_issue_comment_invalid",
      { retryable: false },
    );
  return comment;
}

/** A successful HTTP write still needs an issue-scoped, bot-authored reply. */
export function requireConfirmedMutationReply(
  data: unknown,
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "pullNumber" | "expectedBotLogin" | "marker"
  >,
  desiredBody: string,
  expectedCommentId?: number,
): ReviewProgressComment {
  const comment = parseCommentOrNull(data);
  const issueUrl = record(data)?.issue_url;
  if (
    !comment ||
    (expectedCommentId !== undefined && comment.id !== expectedCommentId) ||
    comment.body !== desiredBody ||
    !ownsMarker(comment, input) ||
    typeof issueUrl !== "string" ||
    issueUrl.toLowerCase() !== expectedIssueUrl(input).toLowerCase()
  ) {
    // A malformed acknowledgement does not prove that the write failed.
    throw new ReviewProgressGitHubError(
      "ambiguous_mutation",
      "github_issue_comment_mutation_reply_unconfirmed",
      { retryable: true, mutationMayHaveLanded: true },
    );
  }
  return comment;
}

export function ownsMarker(
  comment: ReviewProgressComment,
  input: Pick<UpsertReviewProgressCommentInput, "expectedBotLogin" | "marker">,
): boolean {
  return (
    comment.authorLogin.toLowerCase() ===
      input.expectedBotLogin.toLowerCase() &&
    comment.body.includes(input.marker)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function expectedIssueUrl(
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "pullNumber"
  >,
): string {
  return [
    "https://api.github.com/repos",
    input.owner,
    input.repo,
    "issues",
    input.pullNumber,
  ].join("/");
}

/** Unreadable rows may contain our marker; never certify a destructive scan. */
export function hasUnclassifiedMarker(
  value: unknown,
  marker: string,
  expectedBotLogin: string,
): boolean {
  if (typeof value !== "object" || value === null) return true;
  const body = (value as { body?: unknown }).body;
  if (typeof body === "string") return body.includes(marker);
  const user = (value as { user?: unknown }).user;
  // Neither an unknown author nor an unreadable body can rule out a match.
  if (typeof user !== "object" || user === null) return true;
  const login = (user as { login?: unknown }).login;
  if (typeof login !== "string" || !login.trim()) return true;
  return login.toLowerCase() === expectedBotLogin.toLowerCase();
}

export function isCapacityLimitedScan(
  error: unknown,
): error is ReviewProgressGitHubError {
  return (
    error instanceof ReviewProgressGitHubError &&
    error.kind === "pagination_inconclusive" &&
    error.message === CAPACITY_LIMIT_SCAN
  );
}

/** Trust a recovered known comment only when it belongs to this PR and bot. */
export function verifiedKnownComment(
  data: unknown,
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "pullNumber" | "expectedBotLogin" | "marker"
  >,
  knownId: number,
): ReviewProgressComment | null {
  if (typeof data !== "object" || data === null) {
    throw new ReviewProgressGitHubError(
      "invalid_response",
      "github_known_comment_invalid",
      { retryable: false },
    );
  }
  const issueUrl = (data as { issue_url?: unknown }).issue_url;
  if (typeof issueUrl !== "string") {
    throw new ReviewProgressGitHubError(
      "invalid_response",
      "github_known_comment_issue_missing",
      { retryable: false },
    );
  }
  if (issueUrl.toLowerCase() !== expectedIssueUrl(input).toLowerCase()) {
    return null;
  }
  const known = parseCommentOrNull(data);
  if (!known || known.id !== knownId) {
    throw new ReviewProgressGitHubError(
      "invalid_response",
      "github_known_comment_mismatch",
      { retryable: false },
    );
  }
  if (!ownsMarker(known, input)) return null;
  return known;
}
