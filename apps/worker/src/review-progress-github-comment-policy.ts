import type { UpsertReviewProgressCommentInput } from "./review-progress-github-input-policy";

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
