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
  // Without a complete Link header, a full page is not proof of completion.
  if (
    hasNextPage === false ||
    (hasNextPage === undefined && commentsOnPage < 100)
  ) {
    return "complete";
  }
  if (hasNextPage === "invalid" || page === maxPages) {
    return "inconclusive";
  }
  return "continue";
}

/** Only complete pagination on a well-formed GitHub Link header. */
export function hasNextCommentPage(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
  currentPage: number,
): boolean | "invalid" | undefined {
  const link = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === "link",
  )?.[1];
  if (!Number.isSafeInteger(currentPage) || currentPage < 1) return "invalid";
  if (link === undefined) return undefined;
  if (typeof link !== "string" || !link.trim()) return "invalid";
  const entries = link.split(/,\s*(?=<)/u);
  if (
    !entries.every((entry) =>
      /^\s*<[^>]+>\s*;\s*rel="(?:next|prev|first|last)"\s*$/iu.test(entry),
    )
  ) {
    return "invalid";
  }
  if (entries.some((entry) => /;\s*rel="next"/iu.test(entry))) return true;
  const last = entries.find((entry) => /;\s*rel="last"/iu.test(entry));
  if (!last) return false;
  const href = last.match(/^\s*<([^>]+)>/u)?.[1];
  if (!href) return "invalid";
  try {
    const value = new URL(href).searchParams.get("page");
    if (!value || !/^[1-9]\d*$/u.test(value)) return "invalid";
    const lastPage = Number(value);
    if (!Number.isSafeInteger(lastPage) || lastPage < currentPage) {
      return "invalid";
    }
    return lastPage > currentPage;
  } catch {
    return "invalid";
  }
}

export function parseCommentOrNull(
  value: unknown,
): ReviewProgressComment | null {
  const row = record(value);
  const user = record(row?.user);
  return row &&
    Number.isSafeInteger(row.id) &&
    typeof row.body === "string" &&
    typeof user?.login === "string"
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
