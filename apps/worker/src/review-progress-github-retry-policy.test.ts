import { describe, expect, it } from "vitest";
import {
  classifyGitHubFailure,
  reconciliationFailure,
  unconfirmedMutation,
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

  it("rejects malformed primary reset headers without bypassing backoff", () => {
    for (const reset of [
      "0x0",
      "0b0",
      "0e0",
      "+0",
      "-0",
      "Infinity",
      "2026-08-12T12:00:00Z",
    ]) {
      expect(
        retryBoundary(
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
          now,
          "rate_limit",
        ).getTime(),
      ).toBe(now.getTime() + 60_000);
    }
  });

  it("rejects non-decimal retry delays without bypassing throttle backoff", () => {
    for (const value of [
      "0x0",
      "0b0",
      "0e0",
      "+0",
      "-0",
      "2026-08-12T12:00:00Z",
    ]) {
      const actual = retryBoundary({ "retry-after": value }, now, "rate_limit");
      expect(actual.getTime()).toBe(now.getTime() + 60_000);
    }
    const httpDate = "Wed, 12 Aug 2026 12:00:30 GMT";
    expect(retryBoundary({ "retry-after": httpDate }, now).getTime()).toBe(
      now.getTime() + 30_000,
    );
  });

  it("treats blank Retry-After as absent while retaining an explicit zero", () => {
    for (const retryAfter of ["", " ", "\t"]) {
      const headers = { "retry-after": retryAfter };
      const retryAt = retryBoundary(headers, now, "rate_limit");
      expect(retryAt.getTime()).toBe(now.getTime() + 60_000);
    }
    expect(retryBoundary({ "retry-after": "0" }, now, "rate_limit")).toEqual(
      now,
    );
  });

  it("ignores oversized retry headers while preserving usable boundaries", () => {
    const oversized = "10000000000000";
    const nearDateLimit = "8639999999999.5";
    const fallback = retryBoundary({ "retry-after": oversized }, now);
    const reset = retryBoundary(
      { "retry-after": oversized, "x-ratelimit-reset": "1786536060" },
      now,
    );
    const quota = retryBoundary(
      { "x-ratelimit-reset": nearDateLimit },
      now,
      "rate_limit",
    );
    expect(fallback).toEqual(new Date(now.getTime() + 1_000));
    expect(reset).toEqual(new Date(now.getTime() + 60_000));
    expect(quota).toEqual(new Date(8_639_999_999_999_500));

    const throttled = classifyGitHubFailure(
      {
        status: 429,
        response: {
          headers: {
            "x-ratelimit-reset": nearDateLimit,
            "x-ratelimit-remaining": "0",
          },
        },
      },
      "github_request_failed",
      () => now,
      () => 1,
    );
    expect(throttled.metadata.retryNotBefore).toEqual(quota);
    expect(throttled.metadata.retryAt).toEqual(new Date(8_640_000_000_000_000));

    const unavailable = classifyGitHubFailure(
      { status: 503, response: { headers: { "retry-after": oversized } } },
      "github_request_failed",
      () => now,
      () => 0,
    );
    expect(unavailable.metadata.retryAt).toEqual(
      new Date(now.getTime() + 1_250),
    );
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
    const clippedJitter = jitterAfter(new Date(8_639_999_999_999_500), () => 1);
    expect(clippedJitter).toEqual(new Date(8_640_000_000_000_000));
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
  it("retries GitHub HTTP 408 without suppressing transient timeouts", () => {
    const timeout = classifyGitHubFailure(
      { status: 408, response: { headers: { "retry-after": "30" } } },
      "github_request_failed",
      () => now,
      () => 0,
    );
    expect(timeout.kind).toBe("github_unavailable");
    expect(timeout.metadata.retryable).toBe(true);
    expect(timeout.metadata.retryNotBefore).toEqual(
      new Date(now.getTime() + 30_000),
    );
    expect(timeout.metadata.retryAt).toEqual(new Date(now.getTime() + 30_250));
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
    expect(result.metadata.installationCooldownUntil).toEqual(
      new Date("2026-08-12T12:01:00.250Z"),
    );
  });

  it("keeps PATCH cooldown on a typed inconclusive scan", () => {
    const mutationError = {
      status: 429,
      response: { headers: { "retry-after": "7200" } },
    };
    const observationError = new ReviewProgressGitHubError(
      "pagination_inconclusive",
      "github_comment_scan_inconclusive",
      {
        retryable: true,
        retryAt: new Date("2026-08-12T13:00:00.000Z"),
      },
    );
    const result = reconciliationFailure(
      mutationError,
      observationError,
      () => now,
      () => 0,
    );
    expect(result.kind).toBe("pagination_inconclusive");
    expect(result.metadata.retryAt).toEqual(
      new Date("2026-08-12T14:00:00.250Z"),
    );
    expect(result.metadata.retryNotBefore).toEqual(
      new Date("2026-08-12T14:00:00.000Z"),
    );
    expect(result.metadata.installationCooldownUntil).toEqual(
      new Date("2026-08-12T14:00:00.250Z"),
    );
  });

  it("keeps PATCH throttling cooldown separate from a later GET outage", () => {
    const mutationError = {
      status: 429,
      response: { headers: { "retry-after": "60" } },
    };
    const observationError = {
      status: 503,
      response: { headers: { "retry-after": "7200" } },
    };
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
    expect(result.metadata.installationCooldownUntil).toEqual(
      new Date("2026-08-12T12:01:00.250Z"),
    );
  });

  it("keeps the later of PATCH and GET outage boundaries", () => {
    for (const [mutationDelay, observationDelay] of [
      ["7200", "60"],
      ["60", "7200"],
    ] as const) {
      const mutationError = {
        status: 503,
        response: { headers: { "retry-after": mutationDelay } },
      };
      const observationError = {
        status: 502,
        response: { headers: { "retry-after": observationDelay } },
      };
      const result = reconciliationFailure(
        mutationError,
        observationError,
        () => now,
        () => 0,
      );
      expect(result.kind).toBe("ambiguous_mutation");
      expect(result.metadata.retryAt).toEqual(
        new Date("2026-08-12T14:00:00.250Z"),
      );
      expect(result.metadata.retryNotBefore).toEqual(
        new Date("2026-08-12T14:00:00.000Z"),
      );
      expect(result.metadata.installationCooldownUntil).toBeUndefined();
    }
  });

  it("keeps definite 4xx rejections distinct from uncertain writes", () => {
    const rejected = new ReviewProgressGitHubError(
      "ambiguous_mutation",
      "client_rejected",
      { status: 422, retryable: true },
    );
    expect(unconfirmedMutation(rejected)).toBe(rejected);

    const uncertain = new ReviewProgressGitHubError(
      "ambiguous_mutation",
      "request_timed_out",
      { retryable: true },
    );
    const result = unconfirmedMutation(uncertain);
    expect(result).toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { retryable: true, mutationMayHaveLanded: true },
    });
    expect(result.cause).toBe(uncertain);
  });
});
