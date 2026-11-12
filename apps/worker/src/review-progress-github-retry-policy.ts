/** Pure GitHub retry scheduling and secondary rate-limit detection. */

export function fallbackRetryAt(now: () => Date, random: () => number): Date {
  return jitterAfter(new Date(now().getTime() + 1_000), random);
}

export function isSecondaryRateLimitResponse(
  data: Record<string, unknown> | null,
): boolean {
  if (!data) return false;
  const message =
    typeof data.message === "string" ? data.message.toLowerCase() : "";
  const documentationUrl =
    typeof data.documentation_url === "string"
      ? data.documentation_url.toLowerCase()
      : "";
  return (
    message.includes("secondary rate limit") ||
    message.includes("abuse detection mechanism") ||
    documentationUrl.includes("#about-secondary-rate-limits")
  );
}

export function retryBoundary(
  headers: Readonly<Record<string, string>>,
  now: Date,
  kind: "rate_limit" | "server_unavailable" = "server_unavailable",
): Date {
  const retryAfter = headers["retry-after"];
  let retryAfterTime: number | null = null;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterTime = now.getTime() + seconds * 1_000;
    } else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) {
        retryAfterTime = Math.max(now.getTime(), date);
      }
    }
  }

  const resetHeader = headers["x-ratelimit-reset"];
  const resetSeconds = resetHeader?.trim() ? Number(resetHeader) : Number.NaN;
  const resetTime =
    Number.isFinite(resetSeconds) && resetSeconds >= 0
      ? Math.max(now.getTime(), resetSeconds * 1_000)
      : null;

  // Exhausted primary quota must not retry before either GitHub boundary.
  if (
    kind === "rate_limit" &&
    headers["x-ratelimit-remaining"] === "0" &&
    resetTime !== null
  ) {
    return new Date(Math.max(retryAfterTime ?? now.getTime(), resetTime));
  }
  if (retryAfterTime !== null) return new Date(retryAfterTime);

  // A secondary throttle without Retry-After has at least a one-minute delay.
  if (kind === "rate_limit") {
    return new Date(Math.max(now.getTime() + 60_000, resetTime ?? 0));
  }
  if (resetTime !== null) return new Date(resetTime);
  return new Date(now.getTime() + 1_000);
}

export function jitterAfter(boundary: Date, random: () => number): Date {
  const boundedRandom = Math.min(1, Math.max(0, random()));
  return new Date(boundary.getTime() + 250 + Math.floor(boundedRandom * 750));
}
