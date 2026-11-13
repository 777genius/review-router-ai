import {
  confirmedReconciliation,
  hasNextCommentPage,
  ownsMarker,
  parseCommentOrNull,
  type ReviewProgressComment,
} from "./review-progress-github-comment-policy";
import {
  formatReviewProgressComment,
  pullRequestIdentityViolation,
  validateReviewProgressInput,
  type UpsertReviewProgressCommentInput,
} from "./review-progress-github-input-policy";
import {
  classifyGitHubFailure,
  fallbackRetryAt,
  ReviewProgressGitHubError,
  type ReviewProgressGitHubFailureKind,
} from "./review-progress-github-retry-policy";

export type { ReviewProgressComment } from "./review-progress-github-comment-policy";
export type { UpsertReviewProgressCommentInput } from "./review-progress-github-input-policy";
export { ReviewProgressGitHubError };
export type { ReviewProgressGitHubFailureKind };
export {
  createReviewProgressMarker,
  formatReviewProgressComment,
} from "./review-progress-github-input-policy";

export type ReviewProgressGitHubRequester = (
  route: string,
  parameters?: Readonly<Record<string, unknown>>,
) => Promise<{
  readonly data: unknown;
  readonly headers?: Readonly<Record<string, string | number | undefined>>;
}>;

export type UpsertReviewProgressCommentResult = {
  readonly commentId: number;
  readonly operation:
    | "created"
    | "updated"
    | "reconciled"
    | "duplicate_deleted"
    | "unchanged";
  readonly duplicateCommentIds: readonly number[];
};

export class ReviewProgressGitHubGateway {
  private readonly maxCommentPages: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly request: ReviewProgressGitHubRequester,
    options: {
      readonly maxCommentPages?: number;
      readonly now?: () => Date;
      readonly random?: () => number;
    } = {},
  ) {
    this.maxCommentPages = options.maxCommentPages ?? 5;
    if (!Number.isInteger(this.maxCommentPages) || this.maxCommentPages < 1) {
      throw new Error("review_progress_comment_page_limit_invalid");
    }
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async upsert(
    input: UpsertReviewProgressCommentInput,
  ): Promise<UpsertReviewProgressCommentResult> {
    validateReviewProgressInput(input);
    await this.assertCurrentPullRequest(input);
    // Only comments listed under this PR can be canonical.
    const existing = await this.findMarkedComments(input);
    const canonical =
      existing.find(({ id }) => id === input.knownCommentId) ?? existing[0];
    const duplicates = existing.filter(({ id }) => id !== canonical?.id);
    const desiredBody = formatReviewProgressComment(input.body, input.marker);

    if (canonical) {
      return this.updateExistingComment(
        input,
        canonical,
        duplicates,
        desiredBody,
      );
    }
    return this.createComment(input, desiredBody);
  }

  private async updateExistingComment(
    input: UpsertReviewProgressCommentInput,
    canonical: ReviewProgressComment,
    duplicates: readonly ReviewProgressComment[],
    desiredBody: string,
  ): Promise<UpsertReviewProgressCommentResult> {
    if (canonical.body !== desiredBody) {
      return this.patchChangedComment(
        input,
        canonical.id,
        duplicates,
        desiredBody,
      );
    }

    return this.settleUnchangedComment(input, canonical.id, duplicates);
  }

  /** Reconcile ambiguous PATCH failures without deleting duplicate comments. */
  private async patchChangedComment(
    input: UpsertReviewProgressCommentInput,
    canonicalId: number,
    duplicates: readonly ReviewProgressComment[],
    desiredBody: string,
  ): Promise<UpsertReviewProgressCommentResult> {
    await this.assertCurrentPullRequest(input);
    try {
      await this.request(
        "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        repositoryParameters(input, {
          comment_id: canonicalId,
          body: desiredBody,
        }),
      );
    } catch (error) {
      const reconciled = await this.reconcileMutation(
        input,
        desiredBody,
        error,
        canonicalId,
      );
      return {
        commentId: canonicalId,
        operation: "reconciled",
        duplicateCommentIds: reconciled
          .filter(({ id }) => id !== canonicalId)
          .map(({ id }) => id),
      };
    }
    return {
      commentId: canonicalId,
      operation: "updated",
      duplicateCommentIds: duplicates.map(({ id }) => id),
    };
  }

  private async settleUnchangedComment(
    input: UpsertReviewProgressCommentInput,
    canonicalId: number,
    duplicates: readonly ReviewProgressComment[],
  ): Promise<UpsertReviewProgressCommentResult> {
    const duplicate = duplicates[0];
    if (!duplicate) {
      return {
        commentId: canonicalId,
        operation: "unchanged",
        duplicateCommentIds: [],
      };
    }
    await this.assertCurrentPullRequest(input);
    try {
      await this.request(
        "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
        repositoryParameters(input, { comment_id: duplicate.id }),
      );
    } catch (error) {
      throw this.classify(error, "ambiguous_mutation");
    }
    return {
      commentId: canonicalId,
      operation: "duplicate_deleted",
      duplicateCommentIds: duplicates.slice(1).map(({ id }) => id),
    };
  }

  private async createComment(
    input: UpsertReviewProgressCommentInput,
    desiredBody: string,
  ): Promise<UpsertReviewProgressCommentResult> {
    await this.assertCurrentPullRequest(input);
    try {
      const response = await this.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        repositoryParameters(input, {
          issue_number: input.pullNumber,
          body: desiredBody,
        }),
      );
      const created = parseComment(response.data);
      return {
        commentId: created.id,
        operation: "created",
        duplicateCommentIds: [],
      };
    } catch (error) {
      const reconciled = await this.reconcileMutation(
        input,
        desiredBody,
        error,
      );
      return {
        commentId: reconciled[0]!.id,
        operation: "reconciled",
        duplicateCommentIds: reconciled.slice(1).map(({ id }) => id),
      };
    }
  }

  private async assertCurrentPullRequest(
    input: UpsertReviewProgressCommentInput,
  ): Promise<void> {
    let response: Awaited<ReturnType<ReviewProgressGitHubRequester>>;
    try {
      response = await this.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        repositoryParameters(input, { pull_number: input.pullNumber }),
      );
    } catch (error) {
      throw this.classify(error);
    }
    const violation = pullRequestIdentityViolation(response.data, input);
    if (violation) throw failure(violation.kind, violation.message, false);
  }

  private async findMarkedComments(
    input: UpsertReviewProgressCommentInput,
  ): Promise<ReviewProgressComment[]> {
    const matches: ReviewProgressComment[] = [];
    for (let page = 1; page <= this.maxCommentPages; page += 1) {
      const { comments, hasNextPage } = await this.fetchCommentPage(
        input,
        page,
      );
      for (const value of comments) {
        const comment = parseCommentOrNull(value);
        if (comment && ownsMarker(comment, input)) matches.push(comment);
      }
      // Trust a complete GitHub Link header; without one, stay fail-closed at the cap.
      if (
        hasNextPage === false ||
        (hasNextPage === undefined && comments.length < 100)
      ) {
        break;
      }
      if (hasNextPage === "invalid" || page === this.maxCommentPages) {
        throw failure(
          "pagination_inconclusive",
          "github_issue_comments_pagination_inconclusive",
          true,
        );
      }
    }
    return matches.sort((left, right) => left.id - right.id);
  }

  private async fetchCommentPage(
    input: UpsertReviewProgressCommentInput,
    page: number,
  ): Promise<{
    comments: unknown[];
    hasNextPage: boolean | "invalid" | undefined;
  }> {
    let response: Awaited<ReturnType<ReviewProgressGitHubRequester>>;
    try {
      response = await this.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        repositoryParameters(input, {
          issue_number: input.pullNumber,
          per_page: 100,
          page,
        }),
      );
    } catch (error) {
      throw this.classify(error);
    }
    if (!Array.isArray(response.data)) {
      throw failure("invalid_response", "github_issue_comments_invalid", false);
    }
    return {
      comments: response.data,
      hasNextPage: hasNextCommentPage(response.headers),
    };
  }

  private async reconcileMutation(
    input: UpsertReviewProgressCommentInput,
    desiredBody: string,
    mutationError: unknown,
    expectedCommentId?: number,
  ): Promise<ReviewProgressComment[]> {
    let observed: ReviewProgressComment[];
    try {
      observed = await this.findMarkedComments(input);
    } catch (observationError) {
      if (
        observationError instanceof ReviewProgressGitHubError &&
        (observationError.kind === "pagination_inconclusive" ||
          observationError.kind === "rate_limited")
      ) {
        throw new ReviewProgressGitHubError(
          observationError.kind,
          observationError.message,
          observationError.metadata,
          { cause: { mutationError, observationError } },
        );
      }
      // A failed observation must not erase the PATCH rate-limit boundary.
      const mutationFailure = this.classify(
        mutationError,
        "ambiguous_mutation",
      );
      if (mutationFailure.kind === "rate_limited") {
        throw new ReviewProgressGitHubError(
          mutationFailure.kind,
          mutationFailure.message,
          mutationFailure.metadata,
          { cause: { mutationError, observationError } },
        );
      }
      throw new ReviewProgressGitHubError(
        "ambiguous_mutation",
        "github_progress_comment_mutation_ambiguous",
        { retryable: true, retryAt: fallbackRetryAt(this.now, this.random) },
        { cause: { mutationError, observationError } },
      );
    }
    const confirmed = confirmedReconciliation(
      observed,
      desiredBody,
      expectedCommentId,
    );
    if (confirmed) return confirmed;
    throw this.classify(mutationError, "ambiguous_mutation");
  }

  private classify(
    error: unknown,
    fallbackKind: ReviewProgressGitHubFailureKind = "github_request_failed",
  ): ReviewProgressGitHubError {
    return classifyGitHubFailure(error, fallbackKind, this.now, this.random);
  }
}

function repositoryParameters(
  input: Pick<UpsertReviewProgressCommentInput, "owner" | "repo">,
  extra: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { owner: input.owner, repo: input.repo, ...extra };
}

function parseComment(value: unknown): ReviewProgressComment {
  const comment = parseCommentOrNull(value);
  if (!comment)
    throw failure("invalid_response", "github_issue_comment_invalid", false);
  return comment;
}

function failure(
  kind: ReviewProgressGitHubFailureKind,
  message: string,
  retryable: boolean,
): ReviewProgressGitHubError {
  return new ReviewProgressGitHubError(kind, message, { retryable });
}
