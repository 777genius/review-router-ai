import { withReviewRequestedIoTimeout as withIoTimeout } from "./review-requested-io-timeout";
import type { ReviewRequestedIntent } from "../../domain/review-requested-intent";
import {
  ReviewRequestedClaimStatus,
  ReviewRequestedDispatchSubmissionStatus,
  ReviewRequestedTransitionStatus,
  ReviewRequestedStaleRevisionError,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedDispatchSubmissionResult,
  type ReviewRequestedPreparedDispatchPort,
  type ReviewRequestedIntentCommandPort,
  type ReviewRequestedIntentQueryPort,
} from "../ports/review-requested-intent-ports";
import { ReviewRequestedIntentTerminalReason } from "../../domain/review-requested-intent";
import {
  buildReviewRequestedRetryCandidate,
  defaultReviewRequestedDispatchPolicy,
  validateReviewRequestedDispatchPolicy,
  type ReviewRequestedDispatchPolicy,
  type ReviewRequestedRetryDependencies,
} from "./review-requested-dispatch-policy";

export type DispatchDueReviewRequestedIntentsResult = Readonly<{
  scanned: number;
  claimed: number;
  dispatched: number;
  busy: number;
  failed: number;
  preparationSaturated: boolean;
  preparationsInFlight: number;
  submissionSaturated: boolean;
  submissionsInFlight: number;
}>;

export class DispatchDueReviewRequestedIntents {
  private readonly policy: ReviewRequestedDispatchPolicy;
  private readonly inFlightPreparations = new Set<string>();
  private readonly inFlightSubmissions = new Map<string, symbol>();
  private readonly inFlightBeginnings = new Map<string, symbol>();
  private dispatchTransitionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly queries: ReviewRequestedIntentQueryPort,
    private readonly commands: ReviewRequestedIntentCommandPort,
    private readonly gateway: ReviewRequestedDispatchGatewayPort,
    private readonly clock: { now(): Date },
    private readonly ids: {
      nextClaimId(): string;
      nextRequestId(): string;
    },
    private readonly digest: ReviewRequestedRetryDependencies["digest"],
    policy: ReviewRequestedDispatchPolicy = defaultReviewRequestedDispatchPolicy,
    private readonly canDispatch?: (
      intent: ReviewRequestedIntent,
      signal?: AbortSignal,
    ) => Promise<boolean>,
  ) {
    validateReviewRequestedDispatchPolicy(policy);
    this.policy = policy;
  }

  async execute(input: {
    readonly ownerIdHash: string;
    readonly limit: number;
    readonly signal?: AbortSignal;
  }): Promise<DispatchDueReviewRequestedIntentsResult> {
    assertOwnerHash(input.ownerIdHash);
    assertLimit(input.limit);
    const excludedAtQuery = new Set(this.inFlightPreparations);
    const due = input.signal?.aborted
      ? []
      : await this.queries.listDue({
          now: this.clock.now(),
          limit: input.limit,
          excludeRequestIds: [...excludedAtQuery],
          excludeAlwaysRequestIds: [...this.inFlightBeginnings.keys()],
        });
    const claimedScopes = new Set<string>();
    let claimed = 0;
    let dispatched = 0;
    let busy = 0;
    let failed = 0;
    let preparationSaturated =
      this.inFlightPreparations.size >= maximumPreparationsInFlight;
    if (preparationSaturated) failed += 1;
    let submissionSaturated =
      this.inFlightSubmissions.size >= maximumSubmissionsInFlight;
    if (submissionSaturated) failed += 1;
    const submissions: Array<Promise<"dispatched" | "failed" | "complete">> =
      [];
    const pending: Array<{
      intent: ReviewRequestedIntent;
      preparation: Promise<
        PromiseSettledResult<Awaited<
          ReturnType<ReviewRequestedDispatchGatewayPort["prepare"]>
        > | null>
      >;
    }> = [];

    for (const candidate of due) {
      // An already issued claim is drained below; stop before the next claim.
      if (input.signal?.aborted) break;
      if (this.inFlightBeginnings.has(candidate.requestId)) continue;
      if (this.inFlightPreparations.has(candidate.requestId)) {
        // An abandoned, still-running read cannot issue a POST. At its 24h
        // deadline the store may terminalize the expired claim under lock.
        // Only an excluded request returned by the query is known to have
        // passed its deadline using the query's clock (database clock in PG).
        // A concurrent execute may reserve a different returned candidate; do
        // not reclaim that newly reserved work.
        if (excludedAtQuery.has(candidate.requestId)) {
          const now = this.clock.now();
          const expired = await this.commands.claimIntent({
            requestId: candidate.requestId,
            claimId: this.ids.nextClaimId(),
            ownerIdHash: input.ownerIdHash,
            now,
            claimUntil: new Date(now.getTime() + this.policy.claimDurationMs),
          });
          if (expired.status === ReviewRequestedClaimStatus.PreparationExpired)
            failed += 1;
        }
        continue;
      }
      if (this.inFlightPreparations.size >= maximumPreparationsInFlight) {
        if (!preparationSaturated) failed += 1;
        preparationSaturated = true;
        continue;
      }
      // Reserve before claiming so overlapping maintenance passes cannot start
      // the same unabortable pre-submission operation twice.
      this.inFlightPreparations.add(candidate.requestId);
      const scope = intentScopeKey(candidate);
      if (claimedScopes.has(scope)) {
        this.inFlightPreparations.delete(candidate.requestId);
        busy += 1;
        continue;
      }
      const observedAt = this.clock.now();
      let claim;
      try {
        claim = await this.commands.claimIntent({
          requestId: candidate.requestId,
          claimId: this.ids.nextClaimId(),
          ownerIdHash: input.ownerIdHash,
          now: observedAt,
          claimUntil: new Date(
            observedAt.getTime() + this.policy.claimDurationMs,
          ),
        });
      } catch (error) {
        this.inFlightPreparations.delete(candidate.requestId);
        throw error;
      }
      if (claim.status === ReviewRequestedClaimStatus.PreparationExpired) {
        this.inFlightPreparations.delete(candidate.requestId);
        failed += 1;
        continue;
      }
      if (
        claim.status !== ReviewRequestedClaimStatus.Claimed &&
        claim.status !== ReviewRequestedClaimStatus.Restored
      ) {
        this.inFlightPreparations.delete(candidate.requestId);
        busy += 1;
        continue;
      }
      if (!claim.intent?.claim) {
        this.inFlightPreparations.delete(candidate.requestId);
        throw new Error("review_requested_claim_term_missing");
      }
      claimed += 1;
      claimedScopes.add(scope);

      const intent = claim.intent;
      const preparation = this.startPreparation(intent);
      pending.push({
        intent,
        preparation: preparation.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        ),
      });
    }

    // All pre-submission reads start together and share one short wait window.
    // Only the actual I/O completion releases a reservation, not the timeout.
    await Promise.all(pending.map((item) => item.preparation));
    for (const item of pending) {
      const claim = { intent: item.intent };
      if (!claim.intent.claim)
        throw new Error("review_requested_claim_term_missing");
      const claimTerm = claim.intent.claim;
      const result = await item.preparation;
      if (result.status === "rejected") {
        if (result.reason instanceof ReviewRequestedStaleRevisionError) {
          await this.commands.resolvePreparation({
            requestId: claim.intent.requestId,
            expectedVersion: claim.intent.version,
            claimId: claimTerm.claimId,
            ownerIdHash: claimTerm.ownerIdHash,
            fencingToken: claimTerm.fencingToken,
            now: this.clock.now(),
          });
        }
        failed += 1;
        continue;
      }
      const prepared = result.value;
      if (prepared === null) {
        const stopped = await this.commands.resolvePreparation({
          requestId: claim.intent.requestId,
          expectedVersion: claim.intent.version,
          claimId: claim.intent.claim.claimId,
          ownerIdHash: claim.intent.claim.ownerIdHash,
          fencingToken: claim.intent.claim.fencingToken,
          now: this.clock.now(),
        });
        if (stopped.status !== ReviewRequestedTransitionStatus.Applied)
          failed += 1;
        continue;
      }

      // Another pass may have reclaimed this request while the current pass
      // was waiting for other preparations. Never overwrite its reservation.
      if (this.inFlightSubmissions.has(claim.intent.requestId)) {
        busy += 1;
        continue;
      }
      if (this.inFlightSubmissions.size >= maximumSubmissionsInFlight) {
        if (!submissionSaturated) failed += 1;
        submissionSaturated = true;
        continue;
      }
      // Reserve before durable begin; a saturated pool must not create an
      // uncertain dispatch for which no POST can be started.
      const reservation = Symbol();
      this.inFlightSubmissions.set(claim.intent.requestId, reservation);
      this.inFlightBeginnings.set(claim.intent.requestId, reservation);
      submissions.push(this.startBegin(claim.intent, prepared, reservation));
    }
    // Timed-out POSTs remain unknown. A later confirmed run may still be
    // recorded by the same fenced transition; no second POST is issued.
    for (const outcome of await Promise.all(submissions)) {
      if (outcome === "dispatched") dispatched += 1;
      else if (outcome === "failed") failed += 1;
    }

    return {
      scanned: due.length,
      claimed,
      dispatched,
      busy,
      failed,
      preparationSaturated,
      preparationsInFlight: this.inFlightPreparations.size,
      submissionSaturated,
      submissionsInFlight: this.inFlightSubmissions.size,
    };
  }

  private startBegin(
    intent: ReviewRequestedIntent,
    prepared: ReviewRequestedPreparedDispatchPort,
    reservation: symbol,
  ): Promise<"dispatched" | "failed" | "complete"> {
    const claim = intent.claim;
    if (!claim) throw new Error("review_requested_claim_term_missing");
    let observationExpired = false;
    let handedOff = false;
    const observed = withIoTimeout(
      maximumSubmissionWaitMs,
      async () => {
        try {
          const now = this.clock.now();
          const begun = await this.withDispatchTransition(() =>
            observationExpired
              ? Promise.resolve(null)
              : this.commands.beginSubmission({
                  requestId: intent.requestId,
                  claimId: claim.claimId,
                  ownerIdHash: claim.ownerIdHash,
                  fencingToken: claim.fencingToken,
                  now,
                  nextResolutionAt: new Date(
                    now.getTime() + this.policy.dispatchResolutionDelayMs,
                  ),
                  resolutionDeadlineAt: new Date(
                    now.getTime() + this.policy.dispatchResolutionTimeoutMs,
                  ),
                }),
          );
          if (
            observationExpired ||
            !begun ||
            begun.status !== ReviewRequestedTransitionStatus.Applied ||
            !begun.intent?.claim
          )
            return null;
          handedOff = true;
          return begun.intent;
        } finally {
          if (this.inFlightBeginnings.get(intent.requestId) === reservation) {
            this.inFlightBeginnings.delete(intent.requestId);
          }
          if (
            !handedOff &&
            this.inFlightSubmissions.get(intent.requestId) === reservation
          ) {
            this.inFlightSubmissions.delete(intent.requestId);
          }
        }
      },
      () => {
        observationExpired = true;
      },
    );
    return observed.then(
      (begun) =>
        begun
          ? this.startSubmission(begun, prepared, reservation).catch(
              () => "failed" as const,
            )
          : ("failed" as const),
      () => "failed" as const,
    );
  }

  private async completeSubmission(
    intent: ReviewRequestedIntent,
    submission: ReviewRequestedDispatchSubmissionResult,
  ): Promise<"dispatched" | "failed" | "complete"> {
    const claim = intent.claim;
    if (!claim) return "failed";
    try {
      if (
        submission.status ===
        ReviewRequestedDispatchSubmissionStatus.DefinitelyNoEffect
      ) {
        const now = this.clock.now();
        const successor = await buildReviewRequestedRetryCandidate({
          intent,
          now,
          identitySeed: `definitely-no-effect\0${intent.dispatchAttempt}`,
          dependencies: { ids: this.ids, digest: this.digest },
          policy: this.policy,
        });
        const recovered = await this.withDispatchTransition(() =>
          this.commands.recoverDispatch({
            requestId: intent.requestId,
            expectedVersion: intent.version,
            sourceRunId: null,
            sourceRunAttempt: null,
            now,
            terminalReason:
              successor === null
                ? ReviewRequestedIntentTerminalReason.DispatchAttemptsExhausted
                : ReviewRequestedIntentTerminalReason.DispatchFailedNoEffect,
            successorCandidate: successor,
          }),
        );
        return recovered.status === ReviewRequestedTransitionStatus.Applied ||
          recovered.status === ReviewRequestedTransitionStatus.Restored
          ? "complete"
          : "failed";
      }
      const recordedAt = this.clock.now();
      const recorded = await this.withDispatchTransition(() =>
        this.commands.recordDispatch({
          requestId: intent.requestId,
          claimId: claim.claimId,
          ownerIdHash: claim.ownerIdHash,
          fencingToken: claim.fencingToken,
          sourceRunId: submission.sourceRunId,
          sourceRunAttempt: submission.sourceRunAttempt,
          now: recordedAt,
          nextResolutionAt: new Date(
            recordedAt.getTime() + this.policy.authorizationResolutionDelayMs,
          ),
          resolutionDeadlineAt: new Date(
            recordedAt.getTime() + this.policy.authorizationResolutionTimeoutMs,
          ),
        }),
      );
      return recorded.status === ReviewRequestedTransitionStatus.Applied ||
        recorded.status === ReviewRequestedTransitionStatus.Restored
        ? "dispatched"
        : "failed";
    } catch {
      // A failed write leaves the durable submission for normal reconciliation.
      return "failed";
    }
  }

  private startSubmission(
    intent: ReviewRequestedIntent,
    prepared: ReviewRequestedPreparedDispatchPort,
    reservation: symbol,
  ) {
    let observationExpired = false;
    return withIoTimeout(
      maximumSubmissionWaitMs,
      async (signal) => {
        try {
          const submission = await prepared.submit(signal);
          // Once observation timed out, a late no-effect response must not
          // create a new attempt. Only a confirmed run may be bound late.
          if (
            observationExpired &&
            submission.status !==
              ReviewRequestedDispatchSubmissionStatus.Accepted
          )
            return "failed" as const;
          return await this.completeSubmission(intent, submission);
        } finally {
          if (this.inFlightSubmissions.get(intent.requestId) === reservation) {
            this.inFlightSubmissions.delete(intent.requestId);
          }
        }
      },
      () => {
        observationExpired = true;
      },
    );
  }

  private withDispatchTransition<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.dispatchTransitionTail;
    let release!: () => void;
    this.dispatchTransitionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(() => {
      // Pace normal short transactions without letting a hung database call
      // indefinitely block unrelated dispatches. This timer does not cancel
      // the call: fencing and bounded submission slots remain in force.
      const timer = setTimeout(release, 20);
      return Promise.resolve()
        .then(work)
        .finally(() => {
          clearTimeout(timer);
          release();
        });
    });
  }

  private startPreparation(intent: ReviewRequestedIntent) {
    return withIoTimeout(
      Math.min(
        maximumPreparationWaitMs,
        Math.max(1, Math.floor(this.policy.claimDurationMs * 0.8)),
      ),
      async (signal) => {
        try {
          if (this.canDispatch && !(await this.canDispatch(intent, signal)))
            return null;
          if (signal.aborted)
            throw new Error("review_requested_preparation_timeout");
          return await this.gateway.prepare({ intent, signal });
        } finally {
          this.inFlightPreparations.delete(intent.requestId);
        }
      },
    );
  }
}

// Bounded even when a dependency ignores AbortSignal. The slot is retained
// until the real I/O settles; saturation fails closed instead of leaking work.
const maximumPreparationsInFlight = 32;
const maximumSubmissionsInFlight = 32;
const maximumPreparationWaitMs = 5_000;
const maximumSubmissionWaitMs = 5_000;

function intentScopeKey(input: {
  readonly workspaceId: string;
  readonly repositoryConnectionId: string;
  readonly scmRepositoryIdentityId: string;
  readonly pullRequestNumber: number;
}): string {
  return JSON.stringify([
    input.workspaceId,
    input.repositoryConnectionId,
    input.scmRepositoryIdentityId,
    input.pullRequestNumber,
  ]);
}

function assertOwnerHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("review_requested_owner_hash_invalid");
  }
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000) {
    throw new Error("review_requested_dispatch_limit_invalid");
  }
}
