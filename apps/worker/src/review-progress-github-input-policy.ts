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
  const withoutMarker = body.split(marker).join("").trimEnd();
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
  if (
    !input.marker ||
    !input.marker.startsWith("<!--") ||
    !input.marker.endsWith("-->")
  ) {
    throw new Error("review_progress_marker_invalid");
  }
}
