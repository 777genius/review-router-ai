import { describe, expect, it } from "vitest";
import { ReviewProgressGitHubError } from "./review-progress-github-error";
import {
  CAPACITY_LIMIT_SCAN,
  commentPageScanDecision,
  confirmedReconciliation,
  hasUnclassifiedMarker,
  isCapacityLimitedScan,
  ownsMarker,
  parseComment,
  parseCommentOrNull,
} from "./review-progress-github-comment-policy";
import { commentPageLinks } from "./review-progress-github-link-policy";

function hasNextCommentPage(
  headers: Parameters<typeof commentPageLinks>[0],
  currentPage: number,
) {
  return commentPageLinks(headers, currentPage).hasNextPage;
}

const desired = "published progress";

const marked = (id: number, body: string) => ({
  id,
  body,
  authorLogin: "review-router[bot]",
});

describe("Review progress GitHub comment policy", () => {
  it("requires the expected comment to contain the desired body", () => {
    const observed = [marked(7, "stale"), marked(9, desired)];
    expect(confirmedReconciliation(observed, desired, 7)).toBeNull();
    expect(confirmedReconciliation(observed, desired, 9)).toEqual([
      marked(9, desired),
      marked(7, "stale"),
    ]);
  });

  it("sorts desired comments first with stable IDs", () => {
    const observed = [
      marked(12, "stale"),
      marked(6, desired),
      marked(2, "old"),
    ];
    expect(confirmedReconciliation(observed, desired)).toEqual([
      marked(6, desired),
      marked(2, "old"),
      marked(12, "stale"),
    ]);
    expect(observed[0]?.id).toBe(12);
  });

  it("does not claim reconciliation without the desired body", () => {
    const observed = [marked(3, "stale")];
    expect(confirmedReconciliation(observed, desired)).toBeNull();
  });

  it("distinguishes next, final and absent pagination links", () => {
    const next = `<https://api.github.com/comments?page=2>; rel="next"`;
    const previous = `<https://api.github.com/comments?page=1>; rel="prev"`;
    expect(hasNextCommentPage({ Link: next }, 1)).toBe(true);
    expect(hasNextCommentPage({ link: previous }, 2)).toBe(false);
    const next3 = `<https://api.github.com/comments?page=3>; rel="next"`;
    expect(hasNextCommentPage({ LINK: `${previous}, ${next3}` }, 2)).toBe(true);
    expect(hasNextCommentPage({}, 1)).toBeUndefined();
  });

  it("continues on a last-only Link that identifies a later page", () => {
    const later = '<https://api.github.com/comments?page=3>; rel="last"';
    const final = '<https://api.github.com/comments?page=3>; rel="last"';
    const invalid = '<https://api.github.com/comments?page=oops>; rel="last"';
    expect(hasNextCommentPage({ link: later }, 1)).toBe(true);
    expect(hasNextCommentPage({ link: final }, 3)).toBe(false);
    expect(hasNextCommentPage({ link: later }, 4)).toBe("invalid");
    expect(hasNextCommentPage({ link: invalid }, 1)).toBe("invalid");
    expect(hasNextCommentPage({ link: later }, 0)).toBe("invalid");
  });

  it("exposes the advertised last page for a later scan request", () => {
    const last = '<https://api.github.com/comments?page=3>; rel="last"';
    const previous = '<https://api.github.com/comments?page=1>; rel="prev"';
    expect(commentPageLinks({ link: last }, 1)).toEqual({
      hasNextPage: true,
      lastPage: 3,
    });
    expect(commentPageLinks({ link: previous }, 2)).toEqual({
      hasNextPage: false,
    });
  });

  it("rejects conflicting last links and supports relative last-page targets", () => {
    const conflict =
      '<https://api.github.com/comments?page=1>; rel="last", ' +
      "<https://api.github.com/comments?page=3>; rel=last";
    expect(hasNextCommentPage({ link: conflict }, 1)).toBe("invalid");
    expect(
      commentPageLinks({ link: "</comments?page=3>; rel=last" }, 1),
    ).toEqual({ hasNextPage: true, lastPage: 3 });
  });

  it("rejects a next link beyond its advertised last page", () => {
    const next = '<https://api.github.com/comments?page=2>; rel="next"';
    const last = '<https://api.github.com/comments?page=1>; rel="last"';
    const validLast = '<https://api.github.com/comments?page=3>; rel="last"';
    expect(
      commentPageLinks({ link: [next, last].join(", ") }, 1).hasNextPage,
    ).toBe("invalid");
    expect(commentPageLinks({ link: [next, validLast].join(", ") }, 1)).toEqual(
      {
        hasNextPage: true,
        lastPage: 3,
      },
    );
  });

  it("rejects current and forward prev links", () => {
    for (const page of [2, 3]) {
      const previous = `</comments?page=${page}>; rel="prev"`;
      expect(hasNextCommentPage({ link: previous }, 2)).toBe("invalid");
    }
    expect(
      hasNextCommentPage(
        { link: '<https://api.github.com/comments?page=1>; rel="prev"' },
        2,
      ),
    ).toBe(false);
  });

  it("does not certify a full page from a previous-only Link", () => {
    const previous = '</comments?page=1>; rel="prev"';
    const hint = hasNextCommentPage({ link: previous }, 2);
    expect(hint).toBe(false);
    expect(commentPageScanDecision(hint, 100, 2, 5)).toBe("continue");
    expect(commentPageScanDecision(hint, 99, 2, 5)).toBe("complete");
  });

  it("rejects misleading first links before accepting scan completion", () => {
    const misleading = '</comments?page=3>; rel="first"';
    const decision = hasNextCommentPage({ link: misleading }, 1);
    expect(decision).toBe("invalid");
    const scan = commentPageScanDecision(decision, 100, 1, 5);
    expect(scan).toBe("inconclusive");
    const first = '</comments?page=1>; rel="first"';
    expect(hasNextCommentPage({ link: first }, 1)).toBeUndefined();
    expect(
      commentPageScanDecision(
        hasNextCommentPage({ link: first }, 1),
        100,
        1,
        5,
      ),
    ).toBe("continue");
    const validPrevious =
      '</comments?page=1>; rel="first", </comments?page=1>; rel="prev"';
    expect(hasNextCommentPage({ link: validPrevious }, 2)).toBe(false);
  });

  it("rejects skipped or duplicate next-page links without last metadata", () => {
    const skipped = '</comments?page=3>; rel="next"';
    const next = '</comments?page=2>; rel="next"';
    const decision = hasNextCommentPage({ link: skipped }, 1);
    expect(decision).toBe("invalid");
    const scan = commentPageScanDecision(decision, 100, 1, 5);
    expect(scan).toBe("inconclusive");
    expect(hasNextCommentPage({ link: next }, 1)).toBe(true);
    expect(hasNextCommentPage({ link: `${next}, ${next}` }, 1)).toBe("invalid");
  });

  it("classifies bounded page scan outcomes", () => {
    const scenarios = [
      [false, 100, 5, 5, "inconclusive"],
      [false, 100, 1, 5, "continue"],
      [undefined, 99, 5, 5, "complete"],
      [undefined, 100, 1, 5, "continue"],
      [true, 100, 1, 5, "continue"],
      [true, 100, 5, 5, "inconclusive"],
      [undefined, 100, 5, 5, "inconclusive"],
      ["invalid", 1, 1, 5, "inconclusive"],
    ] as const;
    for (const [hasNextPage, count, page, maxPages, expected] of scenarios) {
      const actualScanDecision = commentPageScanDecision(
        hasNextPage,
        count,
        page,
        maxPages,
      );
      expect(actualScanDecision).toBe(expected);
    }
  });

  it("rejects empty, malformed and non-string Link headers", () => {
    const malformed = `<https://api.github.com/comments?page=2>; rel="next`;
    const unquoted = `<https://api.github.com/comments?page=2>; rel=next`;
    expect(hasNextCommentPage({ link: "" }, 1)).toBe("invalid");
    expect(hasNextCommentPage({ link: malformed }, 1)).toBe("invalid");
    expect(hasNextCommentPage({ link: unquoted }, 1)).toBe(true);
    expect(hasNextCommentPage({ link: 42 }, 1)).toBe("invalid");
  });

  it("rejects malformed Link targets even without a next relation", () => {
    const whitespace = '<not a URL>; rel="prev"';
    const escape = '<https://api.github.com/comments?page=%ZZ>; rel="last"';
    expect(hasNextCommentPage({ link: whitespace }, 2)).toBe("invalid");
    expect(hasNextCommentPage({ link: escape }, 2)).toBe("invalid");
    for (const character of ["\u0000", "\t", "\n", "\r", "\u007f"]) {
      const control = `<https://api.github.com/comments?bad=${character}>; rel="prev"`;
      expect(hasNextCommentPage({ link: control }, 2)).toBe("invalid");
    }
  });

  it("rejects untrusted Link targets even when the only relation is prev", () => {
    for (const href of [
      "javascript:alert(1)",
      "blob:https://api.github.com/comments?page=2",
      "data:text/plain,abc",
      "ftp://api.github.com/comments?page=2",
      "http://api.github.com/comments?page=2",
      "https://untrusted.example/comments?page=2",
      "//untrusted.example/comments?page=2",
    ]) {
      expect(hasNextCommentPage({ link: `<${href}>; rel="prev"` }, 2)).toBe(
        "invalid",
      );
    }
  });

  it("rejects a Link without the requested 100-comment window when issue-scoped", () => {
    const expected = ["/repos/acme/rocket/issues/42/comments"];
    const unbounded =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2>; rel="next"';
    const bounded =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"';
    expect(commentPageLinks({ link: unbounded }, 1, expected)).toEqual({
      hasNextPage: "invalid",
    });
    expect(commentPageLinks({ link: bounded }, 1, expected)).toEqual({
      hasNextPage: true,
    });
  });

  it("rejects pagination hints for another issue collection", () => {
    const expected = ["/repos/acme/rocket/issues/42/comments"];
    const foreign =
      '<https://api.github.com/repos/acme/rocket/issues/43/comments?page=1&per_page=100>; rel="last"';
    const trusted =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"';
    expect(commentPageLinks({ link: foreign }, 1, expected)).toEqual({
      hasNextPage: "invalid",
    });
    expect(commentPageLinks({ link: trusted }, 1, expected)).toEqual({
      hasNextPage: true,
    });
  });

  it("binds every Link relation to the requested issue collection", () => {
    const expected = ["/repos/acme/rocket/issues/42/comments"];
    const foreignIssue = "/repos/acme/rocket/issues/43/comments";
    for (const [relation, currentPage, targetPage] of [
      ["first", 2, 1],
      ["last", 1, 3],
      ["prev", 2, 1],
      ["next", 1, 2],
    ] as const) {
      const href = `https://api.github.com${foreignIssue}?page=${targetPage}&per_page=100`;
      const foreign = `<${href}>; rel="${relation}"`;
      const parsed = commentPageLinks({ link: foreign }, currentPage, expected);
      expect(parsed).toEqual({ hasNextPage: "invalid" });
    }
  });

  it("allows canonical repository-ID Links only for the verified repository", () => {
    const verified = [
      "/repos/acme/rocket/issues/42/comments",
      "/repositories/1300192/issues/42/comments",
    ];
    const valid =
      '<https://api.github.com/repositories/1300192/issues/42/comments?page=2&per_page=100>; rel="next"';
    const foreign =
      '<https://api.github.com/repositories/1300193/issues/42/comments?page=1&per_page=100>; rel="last"';
    expect(commentPageLinks({ link: valid }, 1, verified)).toEqual({
      hasNextPage: true,
    });
    expect(commentPageLinks({ link: foreign }, 1, verified)).toEqual({
      hasNextPage: "invalid",
    });
  });

  it("rejects Link hints with ambiguous duplicate page parameters", () => {
    const cases = [
      ["next", 1, 2],
      ["prev", 2, 1],
      ["first", 2, 1],
      ["last", 1, 1],
    ] as const;
    for (const [relation, currentPage, expectedPage] of cases) {
      const link = `<https://api.github.com/comments?page=${expectedPage}&page=99>; rel="${relation}"`;
      expect(commentPageLinks({ link }, currentPage)).toEqual({
        hasNextPage: "invalid",
      });
    }
  });

  it("rejects Link hints for a different page size or filtered collection", () => {
    for (const suffix of [
      "&per_page=1",
      "&per_page=99",
      "&per_page=100&per_page=100",
      "&since=2026-11-01T00%3A00%3A00Z",
    ]) {
      const link = `<https://api.github.com/comments?page=2${suffix}>; rel="next"`;
      expect(hasNextCommentPage({ link }, 1)).toBe("invalid");
    }
    const trusted =
      '<https://api.github.com/comments?page=2&per_page=100>; rel="next"';
    expect(hasNextCommentPage({ link: trusted }, 1)).toBe(true);
  });

  it("parses only comments with safe IDs, bodies and author logins", () => {
    const raw = { id: 7, body: desired, user: { login: "review-router[bot]" } };
    expect(parseCommentOrNull(raw)).toEqual(marked(7, desired));
    expect(parseCommentOrNull({ ...raw, id: "7" })).toBeNull();
    expect(parseCommentOrNull({ ...raw, id: 0 })).toBeNull();
    expect(parseCommentOrNull({ ...raw, id: -1 })).toBeNull();
    expect(
      parseCommentOrNull({ ...raw, id: Number.MAX_SAFE_INTEGER + 1 }),
    ).toBeNull();
    expect(parseCommentOrNull({ ...raw, body: 42 })).toBeNull();
    expect(parseCommentOrNull({ ...raw, user: null })).toBeNull();
    expect(parseCommentOrNull({ ...raw, user: { login: " " } })).toBeNull();
  });

  it("matches markers only for the expected bot", () => {
    const input = {
      expectedBotLogin: "Review-Router[bot]",
      marker: "<!-- review-router:progress:review -->",
    };
    expect(ownsMarker(marked(7, `body\n${input.marker}`), input)).toBe(true);
    expect(ownsMarker(marked(7, "body"), input)).toBe(false);
    expect(
      ownsMarker(
        { ...marked(7, input.marker), authorLogin: "other[bot]" },
        input,
      ),
    ).toBe(false);
  });

  it("treats unreadable comment rows as potential marked comments", () => {
    const marker = "<!-- review-router:progress:review -->";
    const bot = "review-router[bot]";
    const cases = [
      [null, true],
      [{ body: marker }, true],
      [{ body: "other" }, false],
      [{ body: 42, user: { login: bot } }, true],
      [{ body: 42, user: { login: "other[bot]" } }, false],
      [{ body: 42, user: null }, true],
    ] as const;
    for (const [row, expected] of cases) {
      expect(hasUnclassifiedMarker(row, marker, bot)).toBe(expected);
    }
  });

  it("parses valid write replies and rejects malformed comments", () => {
    const raw = { id: 7, body: desired, user: { login: "review-router[bot]" } };
    expect(parseComment(raw)).toEqual(marked(7, desired));
    expect(() => parseComment({ ...raw, id: "7" })).toThrowError(
      "github_issue_comment_invalid",
    );
  });

  it("recognizes only bounded-scan overflow for known-ID recovery", () => {
    expect(
      isCapacityLimitedScan(
        new ReviewProgressGitHubError(
          "pagination_inconclusive",
          CAPACITY_LIMIT_SCAN,
          { retryable: true },
        ),
      ),
    ).toBe(true);
    for (const [kind, message] of [
      ["pagination_inconclusive", "github_issue_comments_offset_changed"],
      ["invalid_response", CAPACITY_LIMIT_SCAN],
    ] as const) {
      expect(
        isCapacityLimitedScan(
          new ReviewProgressGitHubError(kind, message, { retryable: true }),
        ),
      ).toBe(false);
    }
  });
});
