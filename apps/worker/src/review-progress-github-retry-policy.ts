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

export type ReviewProgressGitHubFailureKind =
  | "stale_head"
  | "repository_mismatch"
  | "revoked_app"
  | "rate_limited"
  | "github_unavailable"
  | "github_request_failed"
  | "ambiguous_mutation"
  | "pagination_inconclusive"
  | "invalid_response";

export class ReviewProgressGitHubError extends Error {
  constructor(
    readonly kind: ReviewProgressGitHubFailureKind,
    message: string,
    readonly metadata: {
      readonly status?: number;
      readonly retryable: boolean;
      /** A jittered instant that is never earlier than GitHub's reset boundary. */
      readonly retryAt?: Date;
      readonly retryNotBefore?: Date;
      readonly installationCooldownUntil?: Date;
    },
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "ReviewProgressGitHubError";
  }
}

/** Classify GitHub transport failures without coupling policy to the gateway. */
export function classifyGitHubFailure(
  error: unknown,
  fallbackKind: ReviewProgressGitHubFailureKind,
  now: () => Date,
  random: () => number,
): ReviewProgressGitHubError {
  if (error instanceof ReviewProgressGitHubError) return error;
  const value = record(error);
  const response = record(value?.response);
  const status = number(value?.status) ?? number(response?.status);
  const headers = normalizeHeaders(
    record(value?.headers) ?? record(response?.headers),
  );
  const responseData = record(response?.data);
  const retryable = classifyRetryableHttpFailure(
    error,
    status,
    headers,
    responseData,
    now,
    random,
  );
  if (retryable) return retryable;
  return fallbackGitHubFailure(error, fallbackKind, status, now, random);
}

/** Preserve non-rate-limit transport and ambiguous-mutation fallbacks. */
function fallbackGitHubFailure(
  error: unknown,
  fallbackKind: ReviewProgressGitHubFailureKind,
  status: number | undefined,
  now: () => Date,
  random: () => number,
): ReviewProgressGitHubError {
  if (status === 403) {
    return new ReviewProgressGitHubError(
      "revoked_app",
      "github_app_access_revoked",
      { status, retryable: false },
      { cause: error },
    );
  }
  return new ReviewProgressGitHubError(
    fallbackKind,
    fallbackKind === "ambiguous_mutation"
      ? "github_progress_comment_mutation_ambiguous"
      : "github_progress_comment_request_failed",
    {
      ...(status === undefined ? {} : { status }),
      retryable: fallbackKind === "ambiguous_mutation",
      ...(fallbackKind === "ambiguous_mutation"
        ? { retryAt: fallbackRetryAt(now, random) }
        : {}),
    },
    { cause: error },
  );
}

/** Isolate retry scheduling for GitHub throttling and server outages. */
function classifyRetryableHttpFailure(
  error: unknown,
  status: number | undefined,
  headers: Readonly<Record<string, string>>,
  responseData: Record<string, unknown> | null,
  now: () => Date,
  random: () => number,
): ReviewProgressGitHubError | null {
  const isRateLimit =
    status === 429 ||
    (status === 403 &&
      (headers["x-ratelimit-remaining"] === "0" ||
        headers["retry-after"] !== undefined ||
        isSecondaryRateLimitResponse(responseData)));
  if (isRateLimit) {
    const retryNotBefore = retryBoundary(headers, now(), "rate_limit");
    const retryAt = jitterAfter(retryNotBefore, random);
    return new ReviewProgressGitHubError(
      "rate_limited",
      "github_progress_comment_rate_limited",
      { status, retryable: true, retryAt, retryNotBefore },
      { cause: error },
    );
  }
  if (status !== undefined && status >= 500) {
    const retryNotBefore = retryBoundary(headers, now());
    return new ReviewProgressGitHubError(
      "github_unavailable",
      "github_progress_comment_unavailable",
      {
        status,
        retryable: true,
        retryNotBefore,
        retryAt: jitterAfter(retryNotBefore, random),
      },
      { cause: error },
    );
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
