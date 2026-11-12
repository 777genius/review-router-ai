import { describe, expect, it } from "vitest";
import {
  confirmedReconciliation,
  hasNextCommentPage,
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

  it("rejects empty, malformed and non-string Link headers", () => {
    const malformed = `<https://api.github.com/comments?page=2>; rel=next`;
    expect(hasNextCommentPage({ link: "" })).toBe("invalid");
    expect(hasNextCommentPage({ link: malformed })).toBe("invalid");
    expect(hasNextCommentPage({ link: 42 })).toBe("invalid");
  });
});
