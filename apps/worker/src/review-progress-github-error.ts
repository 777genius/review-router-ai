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
      /** A failed GitHub write had an outcome that could not be confirmed. */
      readonly mutationMayHaveLanded?: true;
    },
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "ReviewProgressGitHubError";
  }
}
