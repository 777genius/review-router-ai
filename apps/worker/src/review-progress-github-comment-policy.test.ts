import { describe, expect, it } from "vitest";
import {
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
    expect(hasNextCommentPage({ Link: next })).toBe(true);
    expect(hasNextCommentPage({ link: previous })).toBe(false);
    expect(hasNextCommentPage({ LINK: `${previous}, ${next}` })).toBe(true);
    expect(hasNextCommentPage({})).toBeUndefined();
  });

  it.each([
    [false, 100, 5, 5, "complete"],
    [undefined, 99, 5, 5, "complete"],
    [undefined, 100, 1, 5, "continue"],
    [true, 100, 1, 5, "continue"],
    [true, 100, 5, 5, "inconclusive"],
    [undefined, 100, 5, 5, "inconclusive"],
    ["invalid", 1, 1, 5, "inconclusive"],
  ] as const)(
    "classifies a bounded page scan with Link %s, %i comments on page %i/%i",
    (hasNextPage, count, page, maxPages, expected) => {
      expect(
        commentPageScanDecision(hasNextPage, count, page, maxPages),
      ).toBe(expected);
    },
  );

  it("rejects empty, malformed and non-string Link headers", () => {
    const malformed = `<https://api.github.com/comments?page=2>; rel=next`;
    expect(hasNextCommentPage({ link: "" })).toBe("invalid");
    expect(hasNextCommentPage({ link: malformed })).toBe("invalid");
    expect(hasNextCommentPage({ link: 42 })).toBe("invalid");
  });

  it("parses only comments with safe IDs, bodies and author logins", () => {
    const raw = { id: 7, body: desired, user: { login: "review-router[bot]" } };
    expect(parseCommentOrNull(raw)).toEqual(marked(7, desired));
    expect(parseCommentOrNull({ ...raw, id: "7" })).toBeNull();
    expect(parseCommentOrNull({ ...raw, body: 42 })).toBeNull();
    expect(parseCommentOrNull({ ...raw, user: null })).toBeNull();
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
