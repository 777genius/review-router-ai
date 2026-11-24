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
  const transientPaginationRace =
    githubError?.kind === "pagination_inconclusive" &&
    (githubError.message === "github_issue_comments_offset_changed" ||
      githubError.message === "github_canonical_comment_changed_before_patch" ||
      githubError.message ===
        "github_canonical_comment_changed_before_delete" ||
      githubError.message ===
        "github_duplicate_comment_changed_before_delete" ||
      githubError.message === "github_canonical_comment_changed_after_delete");
  if (
    githubError?.kind === "pagination_inconclusive" &&
    !transientPaginationRace
  ) {
    // A capped or untrusted scan is structural; transient offset drift is not.
    const structuralRetryAt = new Date(
      now().getTime() + Math.max(retryDelayMs, 60 * 60_000),
    );
    if (!retryAt || structuralRetryAt.getTime() > retryAt.getTime()) {
      retryAt = structuralRetryAt;
    }
  } else if (!retryAt) {
    retryAt = new Date(now().getTime() + retryDelayMs);
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
