import type { PrismaReviewProgressPublicationStore } from "./review-progress-store";

/** Derive terminal/ongoing publication settlement fields before the fenced write. */
export function completionMutationData(
  input: Parameters<PrismaReviewProgressPublicationStore["complete"]>[0],
) {
  const nextPublishAt = input.publication.terminal
    ? input.now
    : new Date(input.now.getTime() + 60_000);
  return {
    publishedVersion: input.publication.desiredVersion,
    commentId: input.commentId,
    publishedBodyHash: input.bodyHash,
    lastPublishedAt: input.now,
    nextPublishAt,
    claimId: null,
    claimOwnerIdHash: null,
    claimUntil: null,
    failureCount: 0,
    lastErrorCode: null,
    updatedAt: input.now,
  };
}

/** Keep retry exhaustion and error-code policy outside persistence effects. */
export function retryMutationData(
  input: Parameters<PrismaReviewProgressPublicationStore["retry"]>[0],
) {
  const reachesLimit =
    input.countFailure !== false &&
    input.publication.failureCount + 1 >= input.maxFailures;
  return {
    reachesLimit,
    data: {
      ...(reachesLimit
        ? { publishedVersion: input.publication.desiredVersion }
        : {}),
      claimId: null,
      claimOwnerIdHash: null,
      claimUntil: null,
      ...(input.countFailure === false
        ? {}
        : { failureCount: { increment: 1 } }),
      lastErrorCode: reachesLimit
        ? "review_progress_retry_limit_reached"
        : safeCode(input.safeCode),
      nextPublishAt: input.retryAt,
      updatedAt: input.now,
    },
  };
}

export function safeCode(value: string): string {
  return /^[a-z0-9_]{1,120}$/.test(value)
    ? value
    : "review_progress_publish_failed";
}
