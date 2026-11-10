export type ReviewProgressGitHubRequester = (
  route: string,
  parameters?: Readonly<Record<string, unknown>>,
) => Promise<{
  readonly data: unknown;
  readonly headers?: Readonly<Record<string, string | number | undefined>>;
}>;

export type ReviewProgressComment = {
  readonly id: number;
  readonly body: string;
  readonly authorLogin: string;
};

export type UpsertReviewProgressCommentInput = {
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly expectedHeadSha: string;
  readonly expectedBotLogin: string;
  readonly knownCommentId?: number;
  readonly marker: string;
  readonly body: string;
};

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
    },
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "ReviewProgressGitHubError";
  }
}

export function createReviewProgressMarker(stableId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(stableId)) {
    throw new Error("review_progress_marker_id_invalid");
  }
  return `<!-- review-router:progress:${stableId} -->`;
}

/** Formats exactly one stable marker regardless of untrusted body contents. */
export function formatReviewProgressComment(
  body: string,
  marker: string,
): string {
  const withoutMarker = body.split(marker).join("").trimEnd();
  return withoutMarker ? `${withoutMarker}\n\n${marker}` : marker;
}

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
    validateInput(input);
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
    assertCurrentPullRequestData(response.data, input);
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

/** Confirm a mutation only from the complete observed target-PR comment scan. */
function confirmedReconciliation(
  observed: readonly ReviewProgressComment[],
  desiredBody: string,
  expectedCommentId?: number,
): ReviewProgressComment[] | null {
  if (
    !observed.some(
      ({ id, body }) =>
        body === desiredBody &&
        (expectedCommentId === undefined || id === expectedCommentId),
    )
  ) {
    return null;
  }
  return [...observed].sort((left, right) => {
    const desiredOrder =
      Number(right.body === desiredBody) - Number(left.body === desiredBody);
    return desiredOrder || left.id - right.id;
  });
}

/** Only complete pagination on a well-formed GitHub Link header. */
function hasNextCommentPage(
  headers: Readonly<Record<string, string | number | undefined>> | undefined,
): boolean | "invalid" | undefined {
  const link = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === "link",
  )?.[1];
  if (link === undefined) return undefined;
  if (typeof link !== "string" || !link.trim()) return "invalid";
  const entries = link.split(/,\s*(?=<)/u);
  if (
    !entries.every((entry) =>
      /^\s*<[^>]+>\s*;\s*rel="(?:next|prev|first|last)"\s*$/iu.test(entry),
    )
  ) {
    return "invalid";
  }
  return entries.some((entry) => /;\s*rel="next"/iu.test(entry));
}

/** Classify GitHub transport failures without coupling policy to the gateway. */
function classifyGitHubFailure(
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
  const isRateLimit =
    status === 429 ||
    (status === 403 &&
      (headers["x-ratelimit-remaining"] === "0" ||
        headers["retry-after"] !== undefined ||
        isSecondaryRateLimitResponse(responseData)));
  if (isRateLimit) {
    const retryNotBefore = retryBoundary(headers, now(), 60_000);
    const retryAt = jitterAfter(retryNotBefore, random);
    return new ReviewProgressGitHubError(
      "rate_limited",
      "github_progress_comment_rate_limited",
      { status, retryable: true, retryAt, retryNotBefore },
      { cause: error },
    );
  }
  if (status === 403) {
    return new ReviewProgressGitHubError(
      "revoked_app",
      "github_app_access_revoked",
      { status, retryable: false },
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

function fallbackRetryAt(now: () => Date, random: () => number): Date {
  return jitterAfter(new Date(now().getTime() + 1_000), random);
}

/** Validate the remote pull identity independently of the GitHub request. */
function assertCurrentPullRequestData(
  value: unknown,
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "expectedHeadSha"
  >,
): void {
  const row = record(value);
  const head = record(row?.head);
  const base = record(row?.base);
  const repository = record(base?.repo);
  if (
    !row ||
    typeof head?.sha !== "string" ||
    typeof repository?.full_name !== "string"
  ) {
    throw failure("invalid_response", "github_pull_request_invalid", false);
  }
  if (row.state !== "open") {
    throw failure("stale_head", "github_pull_request_not_open", false);
  }
  if (
    repository.full_name.toLowerCase() !==
    `${input.owner}/${input.repo}`.toLowerCase()
  ) {
    throw failure(
      "repository_mismatch",
      "github_pull_request_repository_mismatch",
      false,
    );
  }
  if (head.sha !== input.expectedHeadSha) {
    throw failure("stale_head", "github_pull_request_head_stale", false);
  }
}

function validateInput(input: UpsertReviewProgressCommentInput): void {
  if (
    !input.owner ||
    !input.repo ||
    !Number.isInteger(input.pullNumber) ||
    input.pullNumber < 1
  ) {
    throw new Error("review_progress_github_target_invalid");
  }
  if (!/^[0-9a-f]{40}$/iu.test(input.expectedHeadSha)) {
    throw new Error("review_progress_expected_head_invalid");
  }
  if (!input.expectedBotLogin || !input.expectedBotLogin.endsWith("[bot]")) {
    throw new Error("review_progress_expected_bot_login_invalid");
  }
  if (
    input.knownCommentId !== undefined &&
    (!Number.isSafeInteger(input.knownCommentId) || input.knownCommentId < 1)
  ) {
    throw new Error("review_progress_known_comment_id_invalid");
  }
  if (
    !input.marker ||
    !input.marker.startsWith("<!--") ||
    !input.marker.endsWith("-->")
  ) {
    throw new Error("review_progress_marker_invalid");
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

function parseCommentOrNull(value: unknown): ReviewProgressComment | null {
  const row = record(value);
  const user = record(row?.user);
  return row &&
    Number.isSafeInteger(row.id) &&
    typeof row.body === "string" &&
    typeof user?.login === "string"
    ? { id: row.id as number, body: row.body, authorLogin: user.login }
    : null;
}

function ownsMarker(
  comment: ReviewProgressComment,
  input: Pick<UpsertReviewProgressCommentInput, "expectedBotLogin" | "marker">,
): boolean {
  return (
    comment.authorLogin.toLowerCase() ===
      input.expectedBotLogin.toLowerCase() &&
    comment.body.includes(input.marker)
  );
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

function normalizeHeaders(
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

function isSecondaryRateLimitResponse(
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

function retryBoundary(
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

function jitterAfter(boundary: Date, random: () => number): Date {
  const boundedRandom = Math.min(1, Math.max(0, random()));
  return new Date(boundary.getTime() + 250 + Math.floor(boundedRandom * 750));
}

function failure(
  kind: ReviewProgressGitHubFailureKind,
  message: string,
  retryable: boolean,
): ReviewProgressGitHubError {
  return new ReviewProgressGitHubError(kind, message, { retryable });
}
