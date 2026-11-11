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
    const headers: Record<string, string> = {};
    headers["retry-after"] = "10";
    headers["x-ratelimit-reset"] = String(now.getTime() / 1_000 + 60);
    const actual = retryBoundary(headers, now);
    expect(actual).toEqual(new Date("2026-08-12T12:00:10.000Z"));
  });

  it("falls back to reset time or a one-second delay", () => {
    const headers: Record<string, string> = {};
    headers["retry-after"] = "invalid";
    headers["x-ratelimit-reset"] = String(now.getTime() / 1_000 + 20);
    const resetActual = retryBoundary(headers, now);
    expect(resetActual).toEqual(new Date("2026-08-12T12:00:20.000Z"));
    const fallbackActual = retryBoundary({}, now);
    expect(fallbackActual).toEqual(new Date("2026-08-12T12:00:01.000Z"));
    const staleHeaders: Record<string, string> = {};
    staleHeaders["retry-after"] = "Wed, 12 Aug 2026 11:59:59 GMT";
    expect(retryBoundary(staleHeaders, now)).toEqual(now);
  });

  it("never schedules jitter earlier than the retry boundary", () => {
    const minJitter = jitterAfter(now, () => -1);
    expect(minJitter).toEqual(new Date("2026-08-12T12:00:00.250Z"));
    const maxJitter = jitterAfter(now, () => 2);
    expect(maxJitter).toEqual(new Date("2026-08-12T12:00:01.000Z"));
    const fallback = fallbackRetryAt(() => now, () => 0);
    expect(fallback).toEqual(new Date("2026-08-12T12:00:01.250Z"));
  });

  it("recognizes GitHub secondary limit bodies without headers", () => {
    const secondary = { message: "You have exceeded a secondary rate limit." };
    const forbidden = { message: "Normal forbidden response" };
    expect(isSecondaryRateLimitResponse(secondary)).toBe(true);
    expect(isSecondaryRateLimitResponse(forbidden)).toBe(false);
    expect(isSecondaryRateLimitResponse(null)).toBe(false);
  });
});
