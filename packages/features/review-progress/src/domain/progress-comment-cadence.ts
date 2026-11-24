/**
 * Shortest gap between two same-phase edits of one PR progress comment. Phase
 * changes and terminal states skip it. This is the only place for the cadence;
 * capture and the publisher both read it.
 */
export const progressCommentMinEditIntervalMs = 60_000;

/** Short pause before the first comment so the opening captures coalesce. */
export const progressCommentFirstPublishDelayMs = 1_000;

/**
 * When a newly captured snapshot may be published. GitHub write spacing per
 * installation and the claim/head checks still apply on top of this.
 */
export function progressCommentPublishAt(
  input: Readonly<{
    now: Date;
    /** `null` while this pull request has no published progress comment. */
    lastPublishedAt: Date | null;
    terminal: boolean;
    /** A new phase, or a new review taking over the pull request comment. */
    phaseChanged: boolean;
    /**
     * Schedule of a snapshot that is still unpublished. The new snapshot
     * replaces it and never publishes later, so a pending phase change is not
     * pushed back by a same-phase update right after it.
     */
    pendingPublishAt: Date | null;
  }>,
): Date {
  const scheduled = scheduleFor(input);
  return input.pendingPublishAt !== null && input.pendingPublishAt < scheduled
    ? input.pendingPublishAt
    : scheduled;
}

function scheduleFor(
  input: Parameters<typeof progressCommentPublishAt>[0],
): Date {
  const now = input.now.getTime();
  if (input.terminal) return new Date(now);
  if (input.lastPublishedAt === null) {
    return new Date(now + progressCommentFirstPublishDelayMs);
  }
  if (input.phaseChanged) return new Date(now);
  return new Date(
    Math.max(
      now,
      input.lastPublishedAt.getTime() + progressCommentMinEditIntervalMs,
    ),
  );
}
