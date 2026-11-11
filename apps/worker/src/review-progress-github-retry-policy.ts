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
  fallbackDelayMs = 1_000,
): Date {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(now.getTime() + seconds * 1_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return new Date(Math.max(now.getTime(), date));
  }
  const resetSeconds = Number(headers["x-ratelimit-reset"]);
  if (Number.isFinite(resetSeconds) && resetSeconds >= 0) {
    return new Date(Math.max(now.getTime(), resetSeconds * 1_000));
  }
  return new Date(now.getTime() + fallbackDelayMs);
}

export function jitterAfter(boundary: Date, random: () => number): Date {
  const boundedRandom = Math.min(1, Math.max(0, random()));
  return new Date(boundary.getTime() + 250 + Math.floor(boundedRandom * 750));
}
