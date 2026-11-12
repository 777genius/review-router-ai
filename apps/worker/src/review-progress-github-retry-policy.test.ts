import { describe, expect, it } from "vitest";
import {
  fallbackRetryAt,
  isSecondaryRateLimitResponse,
  jitterAfter,
  retryBoundary,
} from "./review-progress-github-retry-policy";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("Review progress GitHub retry policy", () => {
  it("prefers Retry-After over a later rate-limit reset", () => {
    const retry = { "retry-after": "10" };
    const headers = { ...retry, "x-ratelimit-reset": "1786536060" };
    const actual = retryBoundary(headers, now).getTime();
    expect(actual).toBe(1786536010000);
  });

  it("falls back to reset time or a one-second delay", () => {
    const retry = { "retry-after": "invalid" };
    const headers = { ...retry, "x-ratelimit-reset": "1786536020" };
    const reset = retryBoundary(headers, now).getTime();
    const fallback = retryBoundary({}, now).getTime();
    const stale = { "retry-after": "Wed, 12 Aug 2026 11:59:59 GMT" };
    const expired = retryBoundary(stale, now).getTime();
    expect(reset).toBe(1786536020000);
    expect(fallback).toBe(1786536001000);
    expect(expired).toBe(1786536000000);
  });

  it("never schedules jitter earlier than the retry boundary", () => {
    const low = jitterAfter(now, () => -1).getTime();
    const high = jitterAfter(now, () => 2).getTime();
    const fallback = fallbackRetryAt(() => now, () => 0).getTime();
    expect(low).toBe(1786536000250);
    expect(high).toBe(1786536001000);
    expect(fallback).toBe(1786536001250);
  });

  it("recognizes GitHub secondary limit bodies without headers", () => {
    const secondaryMessage = "You have exceeded a secondary rate limit.";
    const secondary = { message: secondaryMessage };
    const forbidden = { message: "Normal forbidden response" };
    expect(isSecondaryRateLimitResponse(secondary)).toBe(true);
    expect(isSecondaryRateLimitResponse(forbidden)).toBe(false);
    expect(isSecondaryRateLimitResponse(null)).toBe(false);
  });
});
