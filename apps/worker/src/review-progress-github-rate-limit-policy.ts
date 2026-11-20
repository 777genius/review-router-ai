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
  kind: "rate_limit" | "server_unavailable",
): Date {
  const retryAfter = headers["retry-after"]?.trim();
  let retryAfterTime: number | null = null;
  if (retryAfter) {
    if (/^\d+$/u.test(retryAfter)) {
      const seconds = Number(retryAfter);
      const candidate = now.getTime() + seconds * 1_000;
      if (isUsableRetryTimestamp(candidate)) retryAfterTime = candidate;
    } else {
      const date = Date.parse(retryAfter);
      if (
        Number.isFinite(date) &&
        new Date(date).toUTCString() === retryAfter &&
        isUsableRetryTimestamp(date)
      ) {
        retryAfterTime = Math.max(now.getTime(), date);
      }
    }
  }

  const resetHeader = headers["x-ratelimit-reset"]?.trim();
  const resetSeconds =
    resetHeader && /^\d+(?:\.\d+)?$/u.test(resetHeader)
      ? Number(resetHeader)
      : Number.NaN;
  const resetTime =
    Number.isFinite(resetSeconds) &&
    resetSeconds >= 0 &&
    isUsableRetryTimestamp(resetSeconds * 1_000)
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

/** Validate the GitHub deadline itself; jitter is clipped separately. */
function isUsableRetryTimestamp(timestamp: number): boolean {
  return Number.isFinite(new Date(timestamp).getTime());
}

export function jitterAfter(boundary: Date, random: () => number): Date {
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const jitterMs = 250 + Math.floor(boundedRandom * 750);
  const boundaryTime = boundary.getTime();
  // JavaScript Date TimeClip cannot represent instants after this limit.
  const availableJitter = Math.max(0, 8_640_000_000_000_000 - boundaryTime);
  return new Date(boundaryTime + Math.min(jitterMs, availableJitter));
}

/** Normalize GitHub response headers before retry decisions. */
export function normalizeHeaders(
  value: Record<string, unknown> | null,
): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === "string" || typeof entry[1] === "number",
      )
      .map(([key, header]) => [key.toLowerCase(), String(header)]),
  );
}
