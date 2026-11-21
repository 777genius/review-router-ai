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
  if (!isSingleLineReviewProgressMarker(marker)) {
    throw new Error("review_progress_marker_invalid");
  }
  const withoutMarker = body.split(marker).join("\n").trimEnd();
  return withoutMarker ? `${withoutMarker}\n\n${marker}` : marker;
}

/** Validate caller-controlled GitHub target and marker inputs before IO. */
export function validateReviewProgressInput(
  input: UpsertReviewProgressCommentInput,
): void {
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
  if (!isSingleLineReviewProgressMarker(input.marker)) {
    throw new Error("review_progress_marker_invalid");
  }
}

/** Require a complete, single-line comment marker before removal or publishing. */
function isSingleLineReviewProgressMarker(marker: string): boolean {
  return (
    typeof marker === "string" &&
    marker.startsWith("<!--") &&
    marker.endsWith("-->") &&
    !/[\r\n\u2028\u2029]/u.test(marker)
  );
}

/** Classify the GitHub target and head fence without performing I/O. */
export function pullRequestIdentityViolation(
  value: unknown,
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "expectedHeadSha"
  >,
): Readonly<{
  kind: "invalid_response" | "stale_head" | "repository_mismatch";
  message: string;
}> | null {
  const row = record(value);
  const head = record(row?.head);
  const base = record(row?.base);
  const repository = record(base?.repo);
  if (
    !row ||
    typeof head?.sha !== "string" ||
    typeof repository?.full_name !== "string"
  ) {
    return { kind: "invalid_response", message: "github_pull_request_invalid" };
  }
  if (row.state !== "open") {
    return { kind: "stale_head", message: "github_pull_request_not_open" };
  }
  if (
    repository.full_name.toLowerCase() !==
    `${input.owner}/${input.repo}`.toLowerCase()
  ) {
    return {
      kind: "repository_mismatch",
      message: "github_pull_request_repository_mismatch",
    };
  }
  if (head.sha.toLowerCase() !== input.expectedHeadSha.toLowerCase()) {
    return { kind: "stale_head", message: "github_pull_request_head_stale" };
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function repositoryParameters(
  input: Pick<UpsertReviewProgressCommentInput, "owner" | "repo">,
  extra: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { owner: input.owner, repo: input.repo, ...extra };
}

/** Trust a numeric repository ID only after the pull identity was fenced. */
export function repositoryIdFromValidatedPullRequest(
  value: unknown,
): number | undefined {
  const pull = record(value);
  const base = record(pull?.base);
  const repository = record(base?.repo);
  const id = repository?.id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}

/** Scope pagination Links to the requested PR's issue comment collection. */
export function expectedIssueCommentCollectionPaths(
  input: Pick<
    UpsertReviewProgressCommentInput,
    "owner" | "repo" | "pullNumber"
  >,
  verifiedRepositoryId?: number,
): string[] {
  const paths = [
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.pullNumber}/comments`,
  ];
  if (verifiedRepositoryId !== undefined) {
    paths.push(
      `/repositories/${verifiedRepositoryId}/issues/${input.pullNumber}/comments`,
    );
  }
  return paths;
}
