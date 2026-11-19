import {
  commentPageScanDecision,
  confirmedReconciliation,
  commentPageLinks,
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
  reconciliationFailure,
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
    const repositoryId = await this.assertCurrentPullRequest(input);
    // Only comments listed under this PR can be canonical.
    let existing: ReviewProgressComment[];
    try {
      existing = await this.findMarkedComments(input, repositoryId);
    } catch (error) {
      existing = await this.knownCommentAfterInconclusiveScan(input, error);
    }
    existing = await this.includeVerifiedKnownComment(input, existing);
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

  /**
   * Busy PRs can exceed the bounded scan. A verified known comment may still be
   * updated in place, but nothing is created or deleted without a complete scan.
   */
  private async knownCommentAfterInconclusiveScan(
    input: UpsertReviewProgressCommentInput,
    scanError: unknown,
  ): Promise<ReviewProgressComment[]> {
    if (
      input.knownCommentId === undefined ||
      !(scanError instanceof ReviewProgressGitHubError) ||
      scanError.kind !== "pagination_inconclusive"
    ) {
      throw scanError;
    }
    const known = await this.includeVerifiedKnownComment(input, []);
    if (known.length === 0) throw scanError;
    return known;
  }

  /** Conclusive offset scans can still miss a known comment during deletions. */
  private async includeVerifiedKnownComment(
    input: UpsertReviewProgressCommentInput,
    scanned: ReviewProgressComment[],
  ): Promise<ReviewProgressComment[]> {
    const knownId = input.knownCommentId;
    if (knownId === undefined || scanned.some(({ id }) => id === knownId)) {
      return scanned;
    }

    let response: Awaited<ReturnType<ReviewProgressGitHubRequester>>;
    try {
      response = await this.request(
        "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
        repositoryParameters(input, { comment_id: knownId }),
      );
    } catch (error) {
      const classified = this.classify(error, "github_unavailable");
      if (classified.metadata.status === 404) {
        // The completed PR scan remains authoritative after a known ID is deleted.
        return scanned;
      }
      throw classified;
    }

    const data = response.data;
    if (typeof data !== "object" || data === null) {
      throw failure("invalid_response", "github_known_comment_invalid", false);
    }
    const issueUrl = (data as { issue_url?: unknown }).issue_url;
    if (typeof issueUrl !== "string") {
      throw failure(
        "invalid_response",
        "github_known_comment_issue_missing",
        false,
      );
    }
    const expectedIssueUrl = [
      "https://api.github.com/repos",
      input.owner,
      input.repo,
      "issues",
      input.pullNumber,
    ].join("/");
    if (issueUrl.toLowerCase() !== expectedIssueUrl.toLowerCase()) {
      return scanned;
    }
    const known = parseCommentOrNull(data);
    if (!known || known.id !== knownId) {
      throw failure("invalid_response", "github_known_comment_mismatch", false);
    }
    if (!ownsMarker(known, input)) return scanned;
    return [...scanned, known].sort((left, right) => left.id - right.id);
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
      const classified = this.classify(error, "ambiguous_mutation");
      if (classified.kind === "revoked_app") throw classified;
      throw new ReviewProgressGitHubError(
        classified.kind,
        classified.message,
        { ...classified.metadata, mutationMayHaveLanded: true },
        { cause: classified },
      );
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
  ): Promise<number | undefined> {
    let response: Awaited<ReturnType<ReviewProgressGitHubRequester>>;
    try {
      response = await this.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        repositoryParameters(input, { pull_number: input.pullNumber }),
      );
    } catch (error) {
      throw this.classify(error, "github_unavailable");
    }
    const violation = pullRequestIdentityViolation(response.data, input);
    if (violation) throw failure(violation.kind, violation.message, false);
    // GitHub may use /repositories/{id} rather than /repos/{owner}/{repo}
    // in pagination Links. Trust its numeric ID only after target validation.
    const repository = response.data as {
      base?: { repo?: { id?: unknown } };
    };
    const id = repository?.base?.repo?.id;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0
      ? id
      : undefined;
  }

  private async findMarkedComments(
    input: UpsertReviewProgressCommentInput,
    verifiedRepositoryId?: number,
  ): Promise<ReviewProgressComment[]> {
    const matches: ReviewProgressComment[] = [];
    let advertisedLastPage: number | undefined;
    for (let page = 1; page <= this.maxCommentPages; page += 1) {
      const { comments, hasNextPage, lastPage } = await this.fetchCommentPage(
        input,
        page,
        verifiedRepositoryId,
      );
      for (const value of comments) {
        const comment = parseCommentOrNull(value);
        if (comment && ownsMarker(comment, input)) matches.push(comment);
        if (
          !comment &&
          hasUnclassifiedMarker(value, input.marker, input.expectedBotLogin)
        ) {
          throw failure(
            "pagination_inconclusive",
            "github_issue_comments_marked_row_unclassified",
            true,
          );
        }
      }
      if (lastPage !== undefined) {
        if (advertisedLastPage !== undefined && lastPage < advertisedLastPage) {
          throw failure(
            "pagination_inconclusive",
            "github_issue_comments_last_page_conflict",
            true,
          );
        }
        advertisedLastPage = lastPage;
      }
      const effectiveNextPage =
        hasNextPage === "invalid"
          ? "invalid"
          : advertisedLastPage !== undefined && page < advertisedLastPage
            ? true
            : hasNextPage;
      const decision = commentPageScanDecision(
        effectiveNextPage,
        comments.length,
        page,
        this.maxCommentPages,
      );
      if (decision === "complete") break;
      if (decision === "inconclusive") {
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
    verifiedRepositoryId?: number,
  ): Promise<{
    comments: unknown[];
    hasNextPage: boolean | "invalid" | undefined;
    lastPage?: number;
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
      throw this.classify(error, "github_unavailable");
    }
    if (!Array.isArray(response.data)) {
      throw failure("invalid_response", "github_issue_comments_invalid", false);
    }
    return {
      comments: response.data,
      ...commentPageLinks(
        response.headers,
        page,
        [
          `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.pullNumber}/comments`,
          ...(verifiedRepositoryId === undefined
            ? []
            : [`/repositories/${verifiedRepositoryId}/issues/${input.pullNumber}/comments`]),
        ],
      ),
    };
  }

  private async reconcileMutation(
    input: UpsertReviewProgressCommentInput,
    desiredBody: string,
    mutationError: unknown,
    expectedCommentId?: number,
  ): Promise<ReviewProgressComment[]> {
    const classified = this.classify(mutationError, "ambiguous_mutation");
    // A definitive unthrottled 403 did not mutate the comment. An unrelated
    // read failure must not promote this into an ambiguous landed write.
    if (classified.kind === "revoked_app") throw classified;
    let observed: ReviewProgressComment[];
    try {
      observed = await this.findMarkedComments(
        input,
        await this.assertCurrentPullRequest(input),
      );
    } catch (observationError) {
      if (
        expectedCommentId !== undefined &&
        observationError instanceof ReviewProgressGitHubError &&
        observationError.kind === "pagination_inconclusive"
      ) {
        return this.reconcileKnownCommentPatch(
          input,
          desiredBody,
          mutationError,
          expectedCommentId,
          classified,
        );
      }
      throw reconciliationFailure(
        mutationError,
        observationError,
        this.now,
        this.random,
      );
    }
    const confirmed = confirmedReconciliation(
      observed,
      desiredBody,
      expectedCommentId,
    );
    if (confirmed) return confirmed;
    throw unconfirmedMutation(classified);
  }

  /**
   * A busy PR cannot be rescanned completely, so confirm a failed PATCH through
   * its known comment and keep main's short ambiguous retry when unconfirmed.
   */
  private async reconcileKnownCommentPatch(
    input: UpsertReviewProgressCommentInput,
    desiredBody: string,
    mutationError: unknown,
    commentId: number,
    classified: ReviewProgressGitHubError,
  ): Promise<ReviewProgressComment[]> {
    let known: ReviewProgressComment[];
    try {
      known = await this.includeVerifiedKnownComment(
        { ...input, knownCommentId: commentId },
        [],
      );
    } catch (lookupError) {
      throw reconciliationFailure(
        mutationError,
        lookupError,
        this.now,
        this.random,
      );
    }
    if (known.some(({ body }) => body === desiredBody)) return known;
    throw unconfirmedMutation(classified);
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

/**
 * A definite 4xx response proves GitHub rejected the write, so it is retried
 * and counted like on main. Anything else may have landed.
 */
function unconfirmedMutation(
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

function hasUnclassifiedMarker(
  value: unknown,
  marker: string,
  expectedBotLogin: string,
): boolean {
  if (typeof value !== "object" || value === null) return true;
  const body = (value as { body?: unknown }).body;
  if (typeof body === "string") return body.includes(marker);
  const user = (value as { user?: unknown }).user;
  // Neither an unknown author nor an unreadable body can rule out a match.
  if (typeof user !== "object" || user === null) return true;
  const login = (user as { login?: unknown }).login;
  if (typeof login !== "string" || !login.trim()) return true;
  return login.toLowerCase() === expectedBotLogin.toLowerCase();
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
