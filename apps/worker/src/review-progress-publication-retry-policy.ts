import { ReviewProgressGitHubError } from "./review-progress-github-retry-policy";

/** Derive retry metadata separately from persistence and result counters. */
export function publicationRetryPlan(
  error: unknown,
  now: () => Date,
  retryDelayMs: number,
): {
  readonly safeCode: string;
  readonly retryAt: Date;
  readonly installationCooldownUntil?: Date;
  readonly countFailure?: false;
} {
  const githubError = error instanceof ReviewProgressGitHubError ? error : null;
  let retryAt = githubError?.metadata.retryAt;
  if (!retryAt) {
    // A capped scan is structural, not a transient GitHub outage: avoid hot retries.
    retryAt = new Date(
      now().getTime() +
        (githubError?.kind === "pagination_inconclusive"
          ? Math.max(retryDelayMs, 60 * 60_000)
          : retryDelayMs),
    );
  }
  // Never retry before GitHub's hard boundary, even after an inconclusive scan.
  const retryNotBefore = githubError?.metadata.retryNotBefore;
  if (retryNotBefore && retryNotBefore.getTime() > retryAt.getTime()) {
    retryAt = retryNotBefore;
  }
  const mutationCooldown = githubError?.metadata.installationCooldownUntil;
  if (mutationCooldown && mutationCooldown.getTime() > retryAt.getTime()) {
    retryAt = mutationCooldown;
  }
  const installationCooldownUntil =
    mutationCooldown ??
    (githubError?.kind === "rate_limited" ? retryAt : undefined);
  return {
    safeCode: githubError
      ? `review_progress_${githubError.kind}`
      : "review_progress_publish_failed",
    retryAt,
    ...(installationCooldownUntil ? { installationCooldownUntil } : {}),
    // A bounded duplicate scan must never mutate comments or exhaust retries.
    ...(githubError?.kind === "pagination_inconclusive"
      ? { countFailure: false as const }
      : {}),
  };
}
