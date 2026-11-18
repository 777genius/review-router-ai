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

/** Preserve GitHub's last-page hint across a multi-page scan. */
export type CommentPageLinks = {
  readonly hasNextPage: boolean | "invalid" | undefined;
  readonly lastPage?: number;
};

/** Parse only trustworthy pagination hints; invalid metadata fails closed. */
export function commentPageLinks(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
  currentPage: number,
): CommentPageLinks {
  const invalid: CommentPageLinks = { hasNextPage: "invalid" };
  const link = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === "link",
  )?.[1];
  if (!Number.isSafeInteger(currentPage) || currentPage < 1) return invalid;
  if (link === undefined) return { hasNextPage: undefined };
  if (typeof link !== "string" || !link.trim()) return invalid;
  const entries = link.split(/,\s*(?=<)/u);
  if (
    !entries.every((entry) =>
      /^\s*<[^>]+>\s*;\s*rel=(?:"(?:next|prev|first|last)"|(?:next|prev|first|last))\s*$/iu.test(
        entry,
      ),
    )
  ) {
    return invalid;
  }

  // RFC 8288 targets may be relative, but never contain raw whitespace
  // or malformed percent escapes. Bad Link metadata cannot prove completeness.
  for (const entry of entries) {
    const href = entry.match(/^\s*<([^>]+)>/u)?.[1];
    if (!href || /%(?![\da-f]{2})/iu.test(href)) return invalid;
    for (let index = 0; index < href.length; index += 1) {
      const code = href.charCodeAt(index);
      if (code <= 0x20 || code === 0x7f) return invalid;
    }
    try {
      const target = new URL(href, "https://api.github.com");
      if (
        target.protocol !== "https:" ||
        target.origin !== "https://api.github.com"
      ) {
        return invalid;
      }
    } catch {
      return invalid;
    }
  }

  const hasNext = entries.some((entry) =>
    /;\s*rel=(?:"next"|next)\s*$/iu.test(entry),
  );
  const lastEntries = entries.filter((entry) =>
    /;\s*rel=(?:"last"|last)\s*$/iu.test(entry),
  );
  // Multiple last-page declarations cannot establish a safe scan boundary.
  if (lastEntries.length > 1) return invalid;
  const last = lastEntries[0];
  if (!last) return { hasNextPage: hasNext };
  const href = last.match(/^\s*<([^>]+)>/u)?.[1];
  if (!href) return invalid;
  try {
    const value = new URL(href, "https://api.github.com");
    const pageValue = value.searchParams.get("page");
    if (!pageValue || !/^[1-9]\d*$/u.test(pageValue)) return invalid;
    const lastPage = Number(pageValue);
    if (!Number.isSafeInteger(lastPage) || lastPage < currentPage) {
      return invalid;
    }
    if (hasNext) {
      const nextEntry = entries.find((entry) =>
        /;\s*rel=(?:"next"|next)\s*$/iu.test(entry),
      );
      const nextHref = nextEntry?.match(/^\s*<([^>]+)>/u)?.[1];
      if (!nextHref) return invalid;
      const nextTarget = new URL(nextHref, "https://api.github.com");
      const nextPageValue = nextTarget.searchParams.get("page");
      if (!nextPageValue || !/^[1-9]\d*$/u.test(nextPageValue)) {
        return invalid;
      }
      const nextPage = Number(nextPageValue);
      if (
        !Number.isSafeInteger(nextPage) ||
        nextPage <= currentPage ||
        nextPage > lastPage
      ) {
        return invalid;
      }
    }
    return { hasNextPage: hasNext || lastPage > currentPage, lastPage };
  } catch {
    return invalid;
  }
}

/** Compatibility helper for callers that only need the immediate decision. */
export function hasNextCommentPage(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
  currentPage: number,
): boolean | "invalid" | undefined {
  return commentPageLinks(headers, currentPage).hasNextPage;
}

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
