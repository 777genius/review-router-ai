import {
  ReviewProgressGitHubError,
  type ReviewProgressGitHubFailureKind,
} from "./review-progress-github-error";
import {
  fallbackRetryAt,
  isSecondaryRateLimitResponse,
  jitterAfter,
  normalizeHeaders,
  retryBoundary,
} from "./review-progress-github-rate-limit-policy";

export {
  fallbackRetryAt,
  isSecondaryRateLimitResponse,
  jitterAfter,
  normalizeHeaders,
  retryBoundary,
};

export { ReviewProgressGitHubError };
export type { ReviewProgressGitHubFailureKind };

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
  if (fallbackKind === "github_unavailable" && status === undefined) {
    return new ReviewProgressGitHubError(
      "github_unavailable",
      "github_progress_comment_unavailable",
      { retryable: true, retryAt: fallbackRetryAt(now, random) },
      { cause: error },
    );
  }
  const kind =
    fallbackKind === "github_unavailable"
      ? "github_request_failed"
      : fallbackKind;
  return new ReviewProgressGitHubError(
    kind,
    kind === "ambiguous_mutation"
      ? "github_progress_comment_mutation_ambiguous"
      : "github_progress_comment_request_failed",
    {
      ...(status === undefined ? {} : { status }),
      retryable: kind === "ambiguous_mutation",
      ...(kind === "ambiguous_mutation"
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
  if (status === 408 || (status !== undefined && status >= 500)) {
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

/** Merge failed mutation and reconciliation retries without dropping GitHub bounds. */
export function reconciliationFailure(
  mutationError: unknown,
  observationError: unknown,
  now: () => Date,
  random: () => number,
): ReviewProgressGitHubError {
  if (
    observationError instanceof ReviewProgressGitHubError &&
    (observationError.kind === "pagination_inconclusive" ||
      observationError.kind === "rate_limited")
  ) {
    const mutationFailure = classifyGitHubFailure(
      mutationError,
      "ambiguous_mutation",
      now,
      random,
    );
    const mutationCooldown =
      mutationFailure.kind === "rate_limited"
        ? mutationFailure.metadata.retryAt
        : undefined;
    const mutationRetryAt =
      mutationFailure.kind === "rate_limited" ||
      mutationFailure.kind === "github_unavailable"
        ? mutationFailure.metadata.retryAt
        : undefined;
    const observationRetryAt = observationError.metadata.retryAt;
    let observationCooldown: Date | undefined;
    if (observationError.kind === "rate_limited") {
      observationCooldown = observationError.metadata.installationCooldownUntil;
      observationCooldown ??= observationRetryAt;
    }
    const installationCooldownUntil = laterRetryBoundary(
      mutationCooldown,
      observationCooldown,
    );
    const retryAt = laterRetryBoundary(mutationRetryAt, observationRetryAt);
    const retryNotBefore = laterRetryBoundary(
      mutationFailure.metadata.retryNotBefore,
      observationError.metadata.retryNotBefore,
    );
    return new ReviewProgressGitHubError(
      observationError.kind,
      observationError.message,
      {
        ...observationError.metadata,
        mutationMayHaveLanded: true,
        ...(retryAt ? { retryAt } : {}),
        ...(retryNotBefore ? { retryNotBefore } : {}),
        ...(installationCooldownUntil ? { installationCooldownUntil } : {}),
      },
      { cause: { mutationError, observationError } },
    );
  }
  // A failed observation must not erase the PATCH rate-limit boundary.
  const mutationFailure = classifyGitHubFailure(
    mutationError,
    "ambiguous_mutation",
    now,
    random,
  );
  if (mutationFailure.kind === "rate_limited") {
    const observationFailure = classifyGitHubFailure(
      observationError,
      "github_request_failed",
      now,
      random,
    );
    const retryAt = laterRetryBoundary(
      mutationFailure.metadata.retryAt,
      observationFailure.metadata.retryAt,
    );
    const retryNotBefore = laterRetryBoundary(
      mutationFailure.metadata.retryNotBefore,
      observationFailure.metadata.retryNotBefore,
    );
    return new ReviewProgressGitHubError(
      mutationFailure.kind,
      mutationFailure.message,
      {
        ...mutationFailure.metadata,
        mutationMayHaveLanded: true,
        ...(retryAt ? { retryAt } : {}),
        ...(retryNotBefore ? { retryNotBefore } : {}),
        ...(mutationFailure.metadata.retryAt
          ? { installationCooldownUntil: mutationFailure.metadata.retryAt }
          : {}),
      },
      { cause: { mutationError, observationError } },
    );
  }
  const observationFailure = classifyGitHubFailure(
    observationError,
    "github_request_failed",
    now,
    random,
  );
  const retryAt = laterRetryBoundary(
    mutationFailure.metadata.retryAt,
    observationFailure.metadata.retryAt,
  );
  const retryNotBefore = laterRetryBoundary(
    mutationFailure.metadata.retryNotBefore,
    observationFailure.metadata.retryNotBefore,
  );
  return new ReviewProgressGitHubError(
    "ambiguous_mutation",
    "github_progress_comment_mutation_ambiguous",
    {
      retryable: true,
      mutationMayHaveLanded: true,
      retryAt: retryAt ?? fallbackRetryAt(now, random),
      ...(retryNotBefore ? { retryNotBefore } : {}),
    },
    { cause: { mutationError, observationError } },
  );
}

/** Preserve the later GitHub retry boundary without shortening cooldowns. */
function laterRetryBoundary(
  left: Date | undefined,
  right: Date | undefined,
): Date | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
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

/** Preserve a definite HTTP rejection, fence outcomes that may have landed. */
export function unconfirmedMutation(
  classified: ReviewProgressGitHubError,
): ReviewProgressGitHubError {
  const status = classified.metadata.status;
  if (
    classified.kind === "ambiguous_mutation" &&
    status !== undefined &&
    status >= 400 &&
    status < 500
  ) {
    return classified;
  }
  return new ReviewProgressGitHubError(
    classified.kind,
    classified.message,
    { ...classified.metadata, mutationMayHaveLanded: true },
    { cause: classified },
  );
}
