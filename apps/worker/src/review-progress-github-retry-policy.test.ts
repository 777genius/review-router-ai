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
    const headers = {
      "retry-after": "10",
      "x-ratelimit-reset": "1786536060",
    };
    const actual = retryBoundary(headers, now).getTime();
    expect(actual).toBe(now.getTime() + 10_000);
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
    const fallback = fallbackRetryAt(() => now, () => 0).getTime();
    expect(low).toBe(now.getTime() + 250);
    expect(high).toBe(now.getTime() + 1_000);
    expect(fallback).toBe(now.getTime() + 1_250);
  });

  it("recognizes GitHub secondary limit bodies without headers", () => {
    const secondary = { message: "You have exceeded a secondary rate limit." };
    const forbidden = { message: "Normal forbidden response" };
    expect(isSecondaryRateLimitResponse(secondary)).toBe(true);
    expect(isSecondaryRateLimitResponse(forbidden)).toBe(false);
    expect(isSecondaryRateLimitResponse(null)).toBe(false);
  });
});
