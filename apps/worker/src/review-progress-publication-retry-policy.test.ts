import { describe, expect, it } from "vitest";
import { ReviewProgressGitHubError } from "./review-progress-github-gateway";
import { publicationRetryPlan } from "./review-progress-publication-retry-policy";

const now = () => new Date("2026-11-12T12:00:00.000Z");

describe("Review progress publication retry policy", () => {
  it("defers inconclusive pagination without exhausting failure count", () => {
    const error = new ReviewProgressGitHubError(
      "pagination_inconclusive",
      "github_issue_comments_pagination_inconclusive",
      { retryable: true },
    );
    expect(publicationRetryPlan(error, now, 2_000)).toEqual({
      safeCode: "review_progress_pagination_inconclusive",
      retryAt: new Date("2026-11-12T13:00:00.000Z"),
      countFailure: false,
    });
    expect(publicationRetryPlan(error, now, 7_200_000).retryAt).toEqual(
      new Date("2026-11-12T14:00:00.000Z"),
    );
  });

  it("keeps a rate-limit retry boundary as installation-wide cooldown", () => {
    const retryAt = new Date("2026-11-12T12:04:00.000Z");
    const error = new ReviewProgressGitHubError(
      "rate_limited",
      "github_progress_comment_rate_limited",
      { retryable: true, retryAt },
    );
    expect(publicationRetryPlan(error, now, 5_000)).toEqual({
      safeCode: "review_progress_rate_limited",
      retryAt,
      installationCooldownUntil: retryAt,
    });
  });

  it("preserves transport retry dates without installation cooldown", () => {
    const retryAt = new Date("2026-11-12T12:03:00.000Z");
    const error = new ReviewProgressGitHubError(
      "github_unavailable",
      "github_progress_comment_unavailable",
      { retryable: true, retryAt },
    );
    expect(publicationRetryPlan(error, now, 5_000)).toEqual({
      safeCode: "review_progress_github_unavailable",
      retryAt,
    });
  });

  it("uses bounded generic fallback scheduling for unknown failures", () => {
    expect(publicationRetryPlan(new Error("offline"), now, 5_000)).toEqual({
      safeCode: "review_progress_publish_failed",
      retryAt: new Date("2026-11-12T12:00:05.000Z"),
    });
  });
  it("honors a later hard boundary for inconclusive scans", () => {
    const retryNotBefore = new Date("2026-11-12T14:00:00.000Z");
    const error = new ReviewProgressGitHubError(
      "pagination_inconclusive",
      "github_issue_comments_pagination_inconclusive",
      { retryable: true, retryNotBefore },
    );
    expect(publicationRetryPlan(error, now, 2_000)).toEqual({
      safeCode: "review_progress_pagination_inconclusive",
      retryAt: retryNotBefore,
      countFailure: false,
    });
  });
});
