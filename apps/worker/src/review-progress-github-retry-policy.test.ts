import { describe, expect, it } from "vitest";
import {
  classifyGitHubFailure,
  reconciliationFailure,
  ReviewProgressGitHubError,
  fallbackRetryAt,
  isSecondaryRateLimitResponse,
  jitterAfter,
  normalizeHeaders,
  retryBoundary,
} from "./review-progress-github-retry-policy";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("Review progress GitHub retry policy", () => {
  it("prefers Retry-After over a later rate-limit reset", () => {
    const headers = {
      "retry-after": "10",
      "x-ratelimit-reset": "1786536060",
    };
    const actual = retryBoundary(headers, now).getTime();
    expect(actual).toBe(now.getTime() + 10_000);
  });

  it("uses the later GitHub boundary when primary quota is exhausted", () => {
    const headers = {
      "retry-after": "10",
      "x-ratelimit-reset": "1786536060",
      "x-ratelimit-remaining": "0",
    };
    expect(retryBoundary(headers, now, "rate_limit").getTime()).toBe(
      now.getTime() + 60_000,
    );
  });

  it("honors Retry-After for secondary throttling with quota remaining", () => {
    const headers = {
      "retry-after": "10",
      "x-ratelimit-reset": "1786536060",
      "x-ratelimit-remaining": "42",
    };
    expect(retryBoundary(headers, now, "rate_limit").getTime()).toBe(
      now.getTime() + 10_000,
    );
  });

  it("applies a minimum minute for throttling without Retry-After", () => {
    const headers = {
      "x-ratelimit-reset": "1786536020",
      "x-ratelimit-remaining": "42",
    };
    expect(retryBoundary(headers, now, "rate_limit").getTime()).toBe(
      now.getTime() + 60_000,
    );
    expect(retryBoundary({}, now, "rate_limit").getTime()).toBe(
      now.getTime() + 60_000,
    );
  });

  it("treats blank primary reset headers as absent", () => {
    for (const reset of ["", " ", "\t"]) {
      expect(
        retryBoundary(
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
          now,
          "rate_limit",
        ).getTime(),
      ).toBe(now.getTime() + 60_000);
    }
  });

  it("falls back to reset time or a one-second delay", () => {
    const headers = {
      "retry-after": "invalid",
      "x-ratelimit-reset": "1786536020",
    };
    const stale = { "retry-after": "Wed, 12 Aug 2026 11:59:59 GMT" };
    const reset = retryBoundary(headers, now).getTime();
    const fallback = retryBoundary({}, now).getTime();
    const expired = retryBoundary(stale, now).getTime();
    expect(reset).toBe(now.getTime() + 20_000);
    expect(fallback).toBe(now.getTime() + 1_000);
    expect(expired).toBe(now.getTime());
  });

  it("never schedules jitter earlier than the retry boundary", () => {
    const low = jitterAfter(now, () => -1).getTime();
    const high = jitterAfter(now, () => 2).getTime();
    const fallback = fallbackRetryAt(
      () => now,
      () => 0,
    ).getTime();
    expect(low).toBe(now.getTime() + 250);
    expect(high).toBe(now.getTime() + 1_000);
    expect(fallback).toBe(now.getTime() + 1_250);
  });

  it("recognizes GitHub secondary limit bodies without headers", () => {
    const secondaryMessage = "You have exceeded a secondary rate limit.";
    const secondary = { message: secondaryMessage };
    const forbidden = { message: "Normal forbidden response" };
    expect(isSecondaryRateLimitResponse(secondary)).toBe(true);
    expect(isSecondaryRateLimitResponse(forbidden)).toBe(false);
    expect(isSecondaryRateLimitResponse(null)).toBe(false);
  });

  it("normalizes GitHub error headers without interpreting unknown values", () => {
    expect(normalizeHeaders(null)).toEqual({});
    expect(
      normalizeHeaders({
        "Retry-After": 10,
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": 1786536060,
        ignored: false,
        absent: undefined,
      }),
    ).toEqual({
      "retry-after": "10",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1786536060",
    });
  });

  it("classifies primary throttling without early retry", () => {
    const transportError = {
      response: {
        status: 403,
        headers: {
          "retry-after": "10",
          "x-ratelimit-reset": "1786536060",
          "x-ratelimit-remaining": "0",
        },
      },
    };
    const result = classifyGitHubFailure(
      transportError,
      "github_request_failed",
      () => now,
      () => 0,
    );
    expect(result).toBeInstanceOf(ReviewProgressGitHubError);
    expect(result.kind).toBe("rate_limited");
    expect(result.metadata.retryNotBefore?.getTime()).toBe(
      now.getTime() + 60_000,
    );
    expect(result.metadata.retryAt?.getTime()).toBe(now.getTime() + 60_250);
  });

  it("preserves permanent and transient HTTP classifications", () => {
    const current = () => now;
    const random = () => 0;
    const revoked = classifyGitHubFailure(
      { status: 403 },
      "github_request_failed",
      current,
      random,
    );
    const outage = classifyGitHubFailure(
      { status: 502 },
      "github_request_failed",
      current,
      random,
    );
    expect(revoked.kind).toBe("revoked_app");
    expect(revoked.metadata.retryable).toBe(false);
    expect(outage.kind).toBe("github_unavailable");
    expect(outage.metadata.retryable).toBe(true);
  });
  it("keeps a long PATCH outage boundary after a rate-limited GET", () => {
    const mutationError = {
      status: 503,
      response: { headers: { "retry-after": "7200" } },
    };
    const observationError = new ReviewProgressGitHubError(
      "rate_limited",
      "github_progress_comment_rate_limited",
      {
        status: 429,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:01:00.000Z"),
        retryAt: new Date("2026-08-12T12:01:00.250Z"),
      },
    );
    const result = reconciliationFailure(
      mutationError,
      observationError,
      () => now,
      () => 0,
    );
    expect(result.kind).toBe("rate_limited");
    expect(result.metadata.retryAt).toEqual(
      new Date("2026-08-12T14:00:00.250Z"),
    );
    expect(result.metadata.retryNotBefore).toEqual(
      new Date("2026-08-12T14:00:00.000Z"),
    );
  });
});
