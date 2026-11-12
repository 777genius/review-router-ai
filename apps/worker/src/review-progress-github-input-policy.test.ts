import { describe, expect, it } from "vitest";
import {
  createReviewProgressMarker,
  formatReviewProgressComment,
  validateReviewProgressInput,
} from "./review-progress-github-input-policy";

const marker = createReviewProgressMarker("review-42");
const validInput = () => ({
  owner: "example",
  repo: "repo",
  pullNumber: 42,
  expectedHeadSha: "a".repeat(40),
  expectedBotLogin: "review-router[bot]",
  marker,
  body: "working",
});

describe("Review progress GitHub input policy", () => {
  it("accepts valid publication input", () => {
    expect(() => validateReviewProgressInput(validInput())).not.toThrow();
  });

  it("keeps markers stable and deduplicates formatted body markers", () => {
    expect(() => createReviewProgressMarker("<unsafe>")).toThrow(
      "review_progress_marker_id_invalid",
    );
    expect(createReviewProgressMarker("pr:42")).toBe(
      "<!-- review-router:progress:pr:42 -->",
    );
    const duplicated = `working\n${marker}\n${marker}`;
    expect(formatReviewProgressComment(duplicated, marker)).toBe(
      `working\n\n${marker}`,
    );
    expect(formatReviewProgressComment(marker, marker)).toBe(marker);
  });

  it("rejects invalid target, head and bot identity", () => {
    const missingOwner = { ...validInput(), owner: "" };
    const badHead = { ...validInput(), expectedHeadSha: "bad" };
    const badBot = { ...validInput(), expectedBotLogin: "someone" };
    expect(() => validateReviewProgressInput(missingOwner)).toThrow(
      "review_progress_github_target_invalid",
    );
    expect(() => validateReviewProgressInput(badHead)).toThrow(
      "review_progress_expected_head_invalid",
    );
    expect(() => validateReviewProgressInput(badBot)).toThrow(
      "review_progress_expected_bot_login_invalid",
    );
  });

  it("rejects invalid known comment IDs and markers", () => {
    const badId = { ...validInput(), knownCommentId: 0 };
    const badMarker = { ...validInput(), marker: "not-a-marker" };
    expect(() => validateReviewProgressInput(badId)).toThrow(
      "review_progress_known_comment_id_invalid",
    );
    expect(() => validateReviewProgressInput(badMarker)).toThrow(
      "review_progress_marker_invalid",
    );
  });
});
