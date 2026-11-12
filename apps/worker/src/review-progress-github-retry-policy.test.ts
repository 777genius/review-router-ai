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
    expect(retryBoundary(headers, now).getTime()).toBe(1_786_536_010_000);
  });

  it("falls back to reset time or a one-second delay", () => {
    const headers = {
      "retry-after": "invalid",
      "x-ratelimit-reset": "1786536020",
    };
    expect(retryBoundary(headers, now).getTime()).toBe(1_786_536_020_000);
    expect(retryBoundary({}, now).getTime()).toBe(1_786_536_001_000);
    const staleHeaders = { "retry-after": "Wed, 12 Aug 2026 11:59:59 GMT" };
    expect(retryBoundary(staleHeaders, now).getTime()).toBe(1_786_536_000_000);
  });

  it("never schedules jitter earlier than the retry boundary", () => {
    expect(jitterAfter(now, () => -1).getTime()).toBe(1_786_536_000_250);
    expect(jitterAfter(now, () => 2).getTime()).toBe(1_786_536_001_000);
    expect(fallbackRetryAt(() => now, () => 0).getTime()).toBe(
      1_786_536_001_250,
    );
  });

  it("recognizes GitHub secondary limit bodies without headers", () => {
    const secondary = { message: "You have exceeded a secondary rate limit." };
    const forbidden = { message: "Normal forbidden response" };
    expect(isSecondaryRateLimitResponse(secondary)).toBe(true);
    expect(isSecondaryRateLimitResponse(forbidden)).toBe(false);
    expect(isSecondaryRateLimitResponse(null)).toBe(false);
  });
});
