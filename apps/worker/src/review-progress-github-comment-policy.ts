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

/** Preserve GitHub's last-page hint across a multi-page scan. */
export type CommentPageLinks = {
  readonly hasNextPage: boolean | "invalid" | undefined;
  readonly lastPage?: number;
};

/** Parse only trustworthy pagination hints; invalid metadata fails closed. */
export function commentPageLinks(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
  currentPage: number,
  expectedCollectionPaths?: readonly string[],
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
      // Link hints must describe the same unfiltered 100-comment window.
      // Different page sizes or filters cannot certify a complete scan.
      const pageSizes = target.searchParams.getAll("per_page");
      if (
        target.searchParams.getAll("page").length !== 1 ||
        pageSizes.length > 1 ||
        (pageSizes.length === 1 && pageSizes[0] !== "100") ||
        [...target.searchParams.keys()].some(
          (key) => key !== "page" && key !== "per_page",
        )
      ) {
        return invalid;
      }
      if (
        target.protocol !== "https:" ||
        target.origin !== "https://api.github.com" ||
        (expectedCollectionPaths !== undefined &&
          !expectedCollectionPaths.some(
            (path) => path.toLowerCase() === target.pathname.toLowerCase(),
          ))
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

  // A malformed or forward previous-page hint cannot certify a final page.
  const previousEntries = entries.filter((entry) =>
    /;\s*rel=(?:"prev"|prev)\s*$/iu.test(entry),
  );
  if (previousEntries.length > 1) return invalid;
  const previousHref = previousEntries[0]?.match(/^\s*<([^>]+)>/u)?.[1];
  if (previousHref) {
    const previousUrl = new URL(previousHref, "https://api.github.com");
    const previousPageValue = previousUrl.searchParams.get("page");
    if (!previousPageValue || !/^[1-9]\d*$/u.test(previousPageValue)) {
      return invalid;
    }
    const previousPage = Number(previousPageValue);
    if (!Number.isSafeInteger(previousPage) || previousPage >= currentPage) {
      return invalid;
    }
  }

  // A declared first page must really identify page one.
  const firstEntries = entries.filter((entry) =>
    /;\s*rel=(?:"first"|first)\s*$/iu.test(entry),
  );
  if (firstEntries.length > 1) return invalid;
  const firstHref = firstEntries[0]?.match(/^\s*<([^>]+)>/u)?.[1];
  if (firstHref) {
    const firstTarget = new URL(firstHref, "https://api.github.com");
    if (firstTarget.searchParams.get("page") !== "1") return invalid;
  }

  // The gateway reads numbered pages sequentially, never skipping a page.
  const nextEntries = entries.filter((entry) =>
    /;\s*rel=(?:"next"|next)\s*$/iu.test(entry),
  );
  if (nextEntries.length > 1) return invalid;
  let nextPage: number | null = null;
  if (hasNext) {
    const nextHref = nextEntries[0]?.match(/^\s*<([^>]+)>/u)?.[1];
    if (!nextHref) return invalid;
    const nextTarget = new URL(nextHref, "https://api.github.com");
    const pageValue = nextTarget.searchParams.get("page");
    if (!pageValue || !/^[1-9]\d*$/u.test(pageValue)) return invalid;
    nextPage = Number(pageValue);
    if (!Number.isSafeInteger(nextPage) || nextPage !== currentPage + 1) {
      return invalid;
    }
  }

  const lastEntries = entries.filter((entry) =>
    /;\s*rel=(?:"last"|last)\s*$/iu.test(entry),
  );
  // Multiple last-page declarations cannot establish a safe scan boundary.
  if (lastEntries.length > 1) return invalid;
  const last = lastEntries[0];
  if (!last) {
    return {
      hasNextPage: hasNext ? true : previousHref ? false : undefined,
    };
  }
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
    if (nextPage !== null && nextPage > lastPage) return invalid;
    return { hasNextPage: hasNext || lastPage > currentPage, lastPage };
  } catch {
    return invalid;
  }
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
