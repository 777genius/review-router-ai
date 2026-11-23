import {
  CAPACITY_LIMIT_SCAN,
  commentPageScanDecision,
  confirmedReconciliation,
  hasUnclassifiedMarker,
  isCapacityLimitedScan,
  ownsMarker,
  parseCommentOrNull,
  requireConfirmedMutationReply,
  verifiedKnownComment,
  type ReviewProgressComment,
} from "./review-progress-github-comment-policy";
import { commentPageLinks } from "./review-progress-github-link-policy";
import {
  expectedIssueCommentCollectionPaths,
  formatReviewProgressComment,
  pullRequestIdentityViolation,
  repositoryIdFromValidatedPullRequest,
  repositoryParameters,
  validateReviewProgressInput,
  type UpsertReviewProgressCommentInput,
} from "./review-progress-github-input-policy";
import {
  classifyGitHubFailure,
  reconciliationFailure,
  unconfirmedMutation,
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
        repositoryId,
      );
    }
    return this.createComment(input, desiredBody, repositoryId);
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
      !isCapacityLimitedScan(scanError)
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

    const known = verifiedKnownComment(response.data, input, knownId);
    if (!known) return scanned;
    return [...scanned, known].sort((left, right) => left.id - right.id);
  }

  private async updateExistingComment(
    input: UpsertReviewProgressCommentInput,
    canonical: ReviewProgressComment,
    duplicates: readonly ReviewProgressComment[],
    desiredBody: string,
    scannedRepositoryId?: number,
  ): Promise<UpsertReviewProgressCommentResult> {
    if (canonical.body !== desiredBody) {
      return this.patchChangedComment(
        input,
        canonical.id,
        duplicates,
        desiredBody,
        scannedRepositoryId,
      );
    }

    return this.settleUnchangedComment(
      input,
      canonical.id,
      duplicates,
      desiredBody,
      scannedRepositoryId,
    );
  }

  /** Reconcile ambiguous PATCH failures without deleting duplicate comments. */
  private async patchChangedComment(
    input: UpsertReviewProgressCommentInput,
    canonicalId: number,
    duplicates: readonly ReviewProgressComment[],
    desiredBody: string,
    scannedRepositoryId?: number,
  ): Promise<UpsertReviewProgressCommentResult> {
    const currentRepositoryId = await this.assertRepositoryId(
      input,
      scannedRepositoryId,
    );
    try {
      const response = await this.request(
        "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        repositoryParameters(input, {
          comment_id: canonicalId,
          body: desiredBody,
        }),
      );
      requireConfirmedMutationReply(
        response.data,
        input,
        desiredBody,
        canonicalId,
      );
    } catch (error) {
      const reconciled = await this.reconcileMutation(
        input,
        desiredBody,
        error,
        canonicalId,
        currentRepositoryId,
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
    desiredBody: string,
    scannedRepositoryId?: number,
  ): Promise<UpsertReviewProgressCommentResult> {
    const duplicate = duplicates[0];
    await this.assertRepositoryId(input, scannedRepositoryId);
    // The scanned canonical may have been deleted or repurposed before settling.
    const verified = await this.includeVerifiedKnownComment(
      { ...input, knownCommentId: canonicalId },
      [],
    );
    if (verified[0]?.body !== desiredBody) {
      throw failure(
        "pagination_inconclusive",
        "github_canonical_comment_changed_before_delete",
        true,
      );
    }
    if (!duplicate) {
      // A new PR head or repository may have appeared during the by-ID read.
      await this.assertRepositoryId(input, scannedRepositoryId);
      return {
        commentId: canonicalId,
        operation: "unchanged",
        duplicateCommentIds: [],
      };
    }
    // Do not delete a once-marked comment repurposed since the offset scan.
    const duplicateNow = await this.includeVerifiedKnownComment(
      { ...input, knownCommentId: duplicate.id },
      [],
    );
    if (duplicateNow[0]?.body !== duplicate.body) {
      throw failure(
        "pagination_inconclusive",
        "github_duplicate_comment_changed_before_delete",
        true,
      );
    }
    // The PR or repository can change during either known-comment read.
    await this.assertRepositoryId(input, scannedRepositoryId);
    try {
      await this.request(
        "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
        repositoryParameters(input, { comment_id: duplicate.id }),
      );
    } catch (error) {
      const classified = this.classify(error, "ambiguous_mutation");
      if (classified.kind === "revoked_app") throw classified;
      throw unconfirmedMutation(classified);
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
    scannedRepositoryId?: number,
  ): Promise<UpsertReviewProgressCommentResult> {
    const currentRepositoryId = await this.assertCurrentPullRequest(input);
    if (
      scannedRepositoryId !== undefined &&
      currentRepositoryId !== scannedRepositoryId
    ) {
      throw failure(
        "repository_mismatch",
        "github_pull_request_repository_identity_changed",
        false,
      );
    }
    try {
      const response = await this.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        repositoryParameters(input, {
          issue_number: input.pullNumber,
          body: desiredBody,
        }),
      );
      const created = requireConfirmedMutationReply(
        response.data,
        input,
        desiredBody,
      );
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
        undefined,
        currentRepositoryId,
      );
      return {
        commentId: reconciled[0]!.id,
        operation: "reconciled",
        duplicateCommentIds: reconciled.slice(1).map(({ id }) => id),
      };
    }
  }

  private async assertRepositoryId(
    input: UpsertReviewProgressCommentInput,
    expectedRepositoryId?: number,
  ): Promise<number | undefined> {
    const currentRepositoryId = await this.assertCurrentPullRequest(input);
    if (
      expectedRepositoryId !== undefined &&
      currentRepositoryId !== expectedRepositoryId
    ) {
      throw failure(
        "repository_mismatch",
        "github_pull_request_repository_identity_changed",
        false,
      );
    }
    return currentRepositoryId;
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
    return repositoryIdFromValidatedPullRequest(response.data);
  }

  private async findMarkedComments(
    input: UpsertReviewProgressCommentInput,
    verifiedRepositoryId?: number,
  ): Promise<ReviewProgressComment[]> {
    const matches: ReviewProgressComment[] = [];
    const observedPages: string[] = [];
    let advertisedLastPage: number | undefined;
    for (let page = 1; page <= this.maxCommentPages; page += 1) {
      const { comments, hasNextPage, lastPage } = await this.fetchCommentPage(
        input,
        page,
        verifiedRepositoryId,
      );
      observedPages.push(JSON.stringify([comments, hasNextPage, lastPage]));
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
        // Only a trusted bounded-scan overflow permits known-ID recovery.
        // Invalid links and offset drift cannot certify duplicate cleanup.
        const capacityLimited =
          page === this.maxCommentPages &&
          effectiveNextPage !== "invalid" &&
          (comments.length === 100 || effectiveNextPage === true);
        if (capacityLimited) {
          // Stable earlier pages are required for capacity recovery.
          await this.recheckObservedCommentPages(
            input,
            observedPages,
            verifiedRepositoryId,
          );
        }
        throw failure(
          "pagination_inconclusive",
          capacityLimited
            ? CAPACITY_LIMIT_SCAN
            : "github_issue_comments_pagination_inconclusive",
          true,
        );
      }
    }
    // A stable earlier page cannot certify that the terminal page stayed
    // empty while it was being rechecked. Fence new-comment creation too.
    await this.recheckObservedCommentPages(
      input,
      observedPages,
      verifiedRepositoryId,
      matches.length === 0,
    );
    return matches.sort((left, right) => left.id - right.id);
  }

  /** Recheck earlier offset pages before authorizing any mutation. */
  private async recheckObservedCommentPages(
    input: UpsertReviewProgressCommentInput,
    observedPages: readonly string[],
    verifiedRepositoryId?: number,
    includeTerminalPage = false,
  ): Promise<void> {
    // GitHub offset pages are not snapshots. Recheck preceding pages for
    // shifts; for an empty scan, also recheck the terminal page before POST.
    const finalPage = includeTerminalPage
      ? observedPages.length
      : observedPages.length - 1;
    for (let page = 1; page <= finalPage; page += 1) {
      const current = await this.fetchCommentPage(
        input,
        page,
        verifiedRepositoryId,
      );
      if (
        JSON.stringify([
          current.comments,
          current.hasNextPage,
          current.lastPage,
        ]) !== observedPages[page - 1]
      ) {
        throw failure(
          "pagination_inconclusive",
          "github_issue_comments_offset_changed",
          true,
        );
      }
    }
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
    const expectedCollectionPaths = expectedIssueCommentCollectionPaths(
      input,
      verifiedRepositoryId,
    );
    return {
      comments: response.data,
      ...commentPageLinks(response.headers, page, expectedCollectionPaths),
    };
  }

  private async reconcileMutation(
    input: UpsertReviewProgressCommentInput,
    desiredBody: string,
    mutationError: unknown,
    expectedCommentId?: number,
    originalRepositoryId?: number,
  ): Promise<ReviewProgressComment[]> {
    const classified = this.classify(mutationError, "ambiguous_mutation");
    // A definitive unthrottled 403 did not mutate the comment. An unrelated
    // read failure must not promote this into an ambiguous landed write.
    if (classified.kind === "revoked_app") throw classified;
    let observed: ReviewProgressComment[];
    let scannedRepositoryId: number | undefined;
    try {
      // A write may land just as the PR head changes. Do not reconcile it
      // against a stale publication identity, even after an earlier fence.
      scannedRepositoryId = await this.assertRepositoryId(
        input,
        originalRepositoryId,
      );
      observed = await this.findMarkedComments(input, scannedRepositoryId);
      // The head or repository can change while reading the comment pages.
      const currentRepositoryId = await this.assertCurrentPullRequest(input);
      if (
        scannedRepositoryId !== undefined &&
        currentRepositoryId !== scannedRepositoryId
      ) {
        throw failure(
          "repository_mismatch",
          "github_pull_request_repository_identity_changed",
          false,
        );
      }
    } catch (observationError) {
      if (
        expectedCommentId !== undefined &&
        isCapacityLimitedScan(observationError)
      ) {
        return this.reconcileKnownCommentPatch(
          input,
          desiredBody,
          mutationError,
          expectedCommentId,
          classified,
          scannedRepositoryId,
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
    scannedRepositoryId?: number,
  ): Promise<ReviewProgressComment[]> {
    let known: ReviewProgressComment[];
    try {
      known = await this.includeVerifiedKnownComment(
        { ...input, knownCommentId: commentId },
        [],
      );
      // Confirm both the head and the numeric repository identity after lookup.
      const currentRepositoryId = await this.assertCurrentPullRequest(input);
      if (
        scannedRepositoryId !== undefined &&
        currentRepositoryId !== scannedRepositoryId
      ) {
        throw failure(
          "repository_mismatch",
          "github_pull_request_repository_identity_changed",
          false,
        );
      }
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

/**
 * A definite 4xx response proves GitHub rejected the write, so it is retried
 * and counted like on main. Anything else may have landed.
 */
function failure(
  kind: ReviewProgressGitHubFailureKind,
  message: string,
  retryable: boolean,
): ReviewProgressGitHubError {
  return new ReviewProgressGitHubError(kind, message, { retryable });
}
