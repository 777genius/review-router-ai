import { createHash } from "node:crypto";
import {
  formatGithubProgressComment,
  githubProgressCommentMarker,
  type ProgressSnapshot,
} from "@reviewrouter/features-review-progress";
import type { Clock } from "@reviewrouter/shared";
import {
  ReviewProgressGitHubError,
  ReviewProgressGitHubGateway,
  type ReviewProgressGitHubRequester,
  type UpsertReviewProgressCommentResult,
} from "./review-progress-github-gateway";
import {
  PrismaReviewProgressPublicationStore,
  type ClaimedReviewProgress,
} from "./review-progress-store";

export const hostedProgressCommentWritesEnv =
  "REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES";

export type ReviewProgressInstallationRequesterFactory = (
  installationId: bigint,
) => Promise<
  Readonly<{
    request: ReviewProgressGitHubRequester;
    botLogin: string;
  }>
>;

export type ReviewProgressPublicationStore = Pick<
  PrismaReviewProgressPublicationStore,
  | "claimNext"
  | "reserveInstallationMutation"
  | "complete"
  | "retry"
  | "suppress"
>;

export type ReviewProgressPublisherResult = Readonly<{
  claimed: number;
  published: number;
  deferred: number;
  suppressed: number;
  failed: number;
}>;

export class ReviewProgressPublisher {
  constructor(
    private readonly store: ReviewProgressPublicationStore,
    private readonly requestForInstallation: ReviewProgressInstallationRequesterFactory,
    private readonly clock: Clock,
    private readonly ownerIdHash: string,
    private readonly options: Readonly<{
      limit: number;
      claimDurationMs: number;
      minimumMutationIntervalMs: number;
      retryDelayMs: number;
      maxCommentPages: number;
      maxFailures: number;
    }>,
  ) {
    assertPositive(options.limit, "review_progress_publish_limit_invalid");
    assertPositive(options.claimDurationMs, "review_progress_claim_ms_invalid");
    assertPositive(
      options.minimumMutationIntervalMs,
      "review_progress_mutation_interval_ms_invalid",
    );
    assertPositive(options.retryDelayMs, "review_progress_retry_ms_invalid");
    assertPositive(
      options.maxCommentPages,
      "review_progress_comment_pages_invalid",
    );
    assertPositive(options.maxFailures, "review_progress_max_failures_invalid");
  }

  async runMaintenance(): Promise<ReviewProgressPublisherResult> {
    const result = {
      claimed: 0,
      published: 0,
      deferred: 0,
      suppressed: 0,
      failed: 0,
    };
    for (let index = 0; index < this.options.limit; index += 1) {
      const publication = await this.store.claimNext({
        ownerIdHash: this.ownerIdHash,
        now: this.clock.now(),
        claimDurationMs: this.options.claimDurationMs,
      });
      if (!publication) break;
      result.claimed += 1;
      await this.publishOne(publication, result);
    }
    return result;
  }

  private async publishOne(
    publication: ClaimedReviewProgress,
    result: {
      published: number;
      deferred: number;
      suppressed: number;
      failed: number;
    },
  ): Promise<void> {
    const now = this.clock.now();
    let body: string;
    try {
      body = formatGithubProgressComment(parseSnapshot(publication.snapshot));
    } catch {
      await this.suppressPublication(
        publication,
        "review_progress_snapshot_invalid",
        now,
        result,
      );
      return;
    }
    const bodyHash = sha256(body);
    if (await this.deferForBusyInstallation(publication, now, result)) return;
    try {
      const published = await this.upsertProgressComment(publication, body);
      await this.settlePublishedMutation(
        publication,
        published,
        bodyHash,
        result,
      );
    } catch (error) {
      await this.handlePublishFailure(publication, error, result);
    }
  }

  /** Keep installation-scoped GitHub effects separate from store settlement. */
  private async upsertProgressComment(
    publication: ClaimedReviewProgress,
    body: string,
  ): Promise<UpsertReviewProgressCommentResult> {
    const installation = await this.requestForInstallation(
      publication.repository.githubInstallationId,
    );
    const gateway = new ReviewProgressGitHubGateway(installation.request, {
      maxCommentPages: this.options.maxCommentPages,
      now: () => this.clock.now(),
    });
    return gateway.upsert({
      owner: publication.repository.owner,
      repo: publication.repository.name,
      pullNumber: publication.scope.pullRequestNumber,
      expectedHeadSha: publication.headSha,
      expectedBotLogin: installation.botLogin,
      ...(publication.commentId === null
        ? {}
        : { knownCommentId: Number(publication.commentId) }),
      marker: githubProgressCommentMarker,
      body,
    });
  }

  /** Preserve installation-budget deferral independently of GitHub writes. */
  private async deferForBusyInstallation(
    publication: ClaimedReviewProgress,
    now: Date,
    result: { deferred: number },
  ): Promise<boolean> {
    const reservation = await this.store.reserveInstallationMutation({
      publication,
      now,
      minimumIntervalMs: Math.max(
        1_000,
        this.options.minimumMutationIntervalMs,
      ),
    });
    if (reservation.allowed) return false;
    await this.store.retry({
      publication,
      safeCode: "review_progress_installation_budget_wait",
      retryAt: reservation.retryAt,
      now,
      maxFailures: this.options.maxFailures,
      countFailure: false,
    });
    result.deferred += 1;
    return true;
  }

  private async settlePublishedMutation(
    publication: ClaimedReviewProgress,
    published: UpsertReviewProgressCommentResult,
    bodyHash: string,
    result: { published: number; deferred: number },
  ): Promise<void> {
    if (published.duplicateCommentIds.length > 0) {
      await this.store.retry({
        publication,
        safeCode: "review_progress_duplicate_cleanup_pending",
        retryAt: new Date(
          this.clock.now().getTime() +
            Math.max(1_000, this.options.minimumMutationIntervalMs),
        ),
        now: this.clock.now(),
        maxFailures: this.options.maxFailures,
        countFailure: false,
      });
      result.deferred += 1;
      return;
    }
    const completed = await this.store.complete({
      publication,
      commentId: BigInt(published.commentId),
      bodyHash,
      now: this.clock.now(),
    });
    if (!completed) {
      result.deferred += 1;
      return;
    }
    result.published += 1;
  }

  /** Count suppression only when its optimistic claim fence actually commits. */
  private async suppressPublication(
    publication: ClaimedReviewProgress,
    safeCode: string,
    now: Date,
    result: { suppressed: number; deferred: number },
  ): Promise<void> {
    const suppressed = await this.store.suppress({
      publication,
      safeCode,
      now,
    });
    if (suppressed) {
      result.suppressed += 1;
    } else {
      result.deferred += 1;
    }
  }

  private async handlePublishFailure(
    publication: ClaimedReviewProgress,
    error: unknown,
    result: { suppressed: number; failed: number; deferred: number },
  ): Promise<void> {
    if (
      error instanceof ReviewProgressGitHubError &&
      !error.metadata.retryable
    ) {
      await this.suppressPublication(
        publication,
        `review_progress_${error.kind}`,
        this.clock.now(),
        result,
      );
      return;
    }
    const retry = publicationRetryPlan(
      error,
      () => this.clock.now(),
      this.options.retryDelayMs,
    );
    const retryOutcome = await this.store.retry({
      publication,
      ...retry,
      now: this.clock.now(),
      maxFailures: this.options.maxFailures,
    });
    if (retryOutcome === "stale") {
      result.deferred += 1;
    } else if (retryOutcome === "suppressed") {
      result.suppressed += 1;
    } else if (retry.countFailure === false) {
      result.deferred += 1;
    } else {
      result.failed += 1;
    }
  }
}

/** Derive retry metadata separately from persistence and result counters. */
function publicationRetryPlan(
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
  if (!retryAt) {
    // A capped scan is structural, not a transient GitHub outage: avoid hot retries.
    retryAt = new Date(
      now().getTime() +
        (githubError?.kind === "pagination_inconclusive"
          ? Math.max(retryDelayMs, 60 * 60_000)
          : retryDelayMs),
    );
  }
  return {
    safeCode: githubError
      ? `review_progress_${githubError.kind}`
      : "review_progress_publish_failed",
    retryAt,
    ...(githubError?.kind === "rate_limited"
      ? { installationCooldownUntil: retryAt }
      : {}),
    // A bounded duplicate scan must never mutate comments or exhaust retries.
    ...(githubError?.kind === "pagination_inconclusive"
      ? { countFailure: false as const }
      : {}),
  };
}

function parseSnapshot(value: unknown): ProgressSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("review_progress_snapshot_invalid");
  }
  const counts = value.counts;
  const fileCoverage = value.fileCoverage;
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    !isPhase(value.phase) ||
    !isTerminal(value.terminal) ||
    typeof value.updatedAt !== "string" ||
    !isRecord(counts) ||
    !validCounts(counts) ||
    !validCoverage(fileCoverage) ||
    !validOptionalSourceIdentity(value.sourceIdentity)
  )
    throw new Error("review_progress_snapshot_invalid");
  return value as unknown as ProgressSnapshot;
}

function validOptionalSourceIdentity(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    typeof value.sourceRunId === "string" &&
    /^[1-9][0-9]{0,19}$/u.test(value.sourceRunId) &&
    typeof value.sourceRunAttempt === "string" &&
    /^[1-9][0-9]{0,9}$/u.test(value.sourceRunAttempt)
  );
}

function validCounts(value: Record<string, unknown>): boolean {
  return [
    "total",
    "completed",
    "exhausted",
    "cancelled",
    "running",
    "pending",
    "retrying",
    "recovered",
    "requiredTotal",
    "requiredCompleted",
    "requiredExhausted",
    "requiredCancelled",
    "optionalTotal",
    "optionalCompleted",
  ].every((key) => isNonNegativeSafeInteger(value[key]));
}

function validCoverage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.valid !== "boolean") return false;
  if (value.valid === false) return true;
  return ["total", "covered", "uncovered", "excluded"].every((key) =>
    isNonNegativeSafeInteger(value[key]),
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPhase(value: unknown): value is ProgressSnapshot["phase"] {
  return [
    "preparing",
    "reviewing",
    "assembling",
    "publishing",
    "terminal",
  ].includes(String(value));
}

function isTerminal(value: unknown): value is ProgressSnapshot["terminal"] {
  return [
    "none",
    "complete",
    "complete_with_gaps",
    "failed",
    "cancelled",
    "superseded",
  ].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertPositive(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code);
}
