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
      "x-ratelimit-reset": String(now.getTime() / 1_000 + 60),
    };
    const actual = retryBoundary(headers, now);
    expect(actual).toEqual(new Date("2026-08-12T12:00:10.000Z"));
  });

  it("falls back to reset time or a one-second delay", () => {
    const resetHeaders = {
      "retry-after": "invalid",
      "x-ratelimit-reset": String(now.getTime() / 1_000 + 20),
    };
    const resetActual = retryBoundary(resetHeaders, now);
    expect(resetActual).toEqual(new Date("2026-08-12T12:00:20.000Z"));

    const fallbackActual = retryBoundary({}, now);
    expect(fallbackActual).toEqual(new Date("2026-08-12T12:00:01.000Z"));

    const staleRetryAfter = "Wed, 12 Aug 2026 11:59:59 GMT";
    const staleHeaders = { "retry-after": staleRetryAfter };
    expect(retryBoundary(staleHeaders, now)).toEqual(now);
  });

  it("never schedules jitter earlier than the retry boundary", () => {
    const minJitter = jitterAfter(now, () => -1);
    const maxJitter = jitterAfter(now, () => 2);
    const fallback = fallbackRetryAt(() => now, () => 0);
    expect(minJitter).toEqual(new Date("2026-08-12T12:00:00.250Z"));
    expect(maxJitter).toEqual(new Date("2026-08-12T12:00:01.000Z"));
    expect(fallback).toEqual(new Date("2026-08-12T12:00:01.250Z"));
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
