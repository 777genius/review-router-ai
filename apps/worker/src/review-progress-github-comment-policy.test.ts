import { describe, expect, it } from "vitest";
import {
  commentPageLinks,
  commentPageScanDecision,
  confirmedReconciliation,
  hasNextCommentPage,
  ownsMarker,
  parseCommentOrNull,
} from "./review-progress-github-comment-policy";

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
    expect(hasNextCommentPage({ LINK: `${previous}, ${next}` }, 1)).toBe(true);
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

  it("classifies bounded page scan outcomes", () => {
    const scenarios = [
      [false, 100, 5, 5, "complete"],
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
  });

  it("rejects untrusted Link targets even when the only relation is prev", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/plain,abc",
      "ftp://api.github.com/comments?page=2",
      "http://api.github.com/comments?page=2",
      "https://untrusted.example/comments?page=2",
      "//untrusted.example/comments?page=2",
    ]) {
      expect(
        hasNextCommentPage({ link: `<${href}>; rel="prev"` }, 2),
      ).toBe("invalid");
    }
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
});
