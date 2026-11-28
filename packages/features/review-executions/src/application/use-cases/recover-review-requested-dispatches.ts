import { withReviewRequestedIoTimeout } from "./review-requested-io-timeout";
import {
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedTransitionStatus,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntentCommandPort,
  type ReviewRequestedIntentQueryPort,
} from "../ports/review-requested-intent-ports";
import {
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  reviewRequestedQueuedRunWaitExtension,
  type ReviewRequestedIntent,
} from "../../domain/review-requested-intent";
import {
  buildReviewRequestedRetryCandidate,
  defaultReviewRequestedDispatchPolicy,
  validateReviewRequestedDispatchPolicy,
  type ReviewRequestedDispatchPolicy,
  type ReviewRequestedRetryDependencies,
} from "./review-requested-dispatch-policy";

export type RecoverReviewRequestedDispatchesResult = Readonly<{
  scanned: number;
  pending: number;
  recovered: number;
  failed: number;
}>;

type CandidateResolution = "pending" | "recovered" | "failed";

/**
 * Resolution passes before the deadline in which a queued run may get one more
 * window. Several, so the check lands before the last minute: a runner that
 * arrives after it still finds a whole window, and one that arrived before it
 * still has time for admission (`reviewRequestedAdmissionHandoffMinimumMs`).
 * Never more than a quarter window, so a long pass interval cannot turn the
 * check into an extension right after dispatch.
 */
const queuedRunExtensionPasses = 4;

export class RecoverReviewRequestedDispatches {
  private readonly policy: ReviewRequestedDispatchPolicy;
  private readonly observationsInFlight = new Set<string>();

  constructor(
    private readonly queries: ReviewRequestedIntentQueryPort,
    private readonly commands: ReviewRequestedIntentCommandPort,
    private readonly gateway: ReviewRequestedDispatchGatewayPort,
    private readonly clock: { now(): Date },
    private readonly retryDependencies: ReviewRequestedRetryDependencies,
    policy: ReviewRequestedDispatchPolicy = defaultReviewRequestedDispatchPolicy,
  ) {
    validateReviewRequestedDispatchPolicy(policy);
    this.policy = policy;
  }

  async execute(input: {
    readonly limit: number;
    readonly signal?: AbortSignal;
  }): Promise<RecoverReviewRequestedDispatchesResult> {
    assertLimit(input.limit);
    const passDeadline = performance.now() + maximumRecoveryPassMs;
    const candidates = input.signal?.aborted
      ? []
      : await this.queries.listDueForResolution({
          now: this.clock.now(),
          limit: input.limit,
        });
    let pending = 0;
    let recovered = 0;
    let failed = 0;

    let visited = 0;
    for (const intent of candidates) {
      if (input.signal?.aborted || performance.now() >= passDeadline) {
        pending += candidates.length - visited;
        break;
      }
      visited += 1;
      let resolution: CandidateResolution;
      try {
        resolution =
          intent.state === ReviewRequestedIntentState.ReconcilingDispatch
            ? await this.reconcileUnknownDispatch(intent, passDeadline)
            : intent.state === ReviewRequestedIntentState.AwaitingAuthorization
              ? await this.resolveAwaitingAuthorization(intent, passDeadline)
              : "failed";
      } catch {
        failed += 1;
        continue;
      }
      if (resolution === "pending") pending += 1;
      else if (resolution === "recovered") recovered += 1;
      else failed += 1;
    }

    return { scanned: candidates.length, pending, recovered, failed };
  }

  private async reconcileUnknownDispatch(
    intent: ReviewRequestedIntent,
    passDeadline: number,
  ): Promise<CandidateResolution> {
    const deadline = requiredDate(
      intent.resolutionDeadlineAt,
      "review_requested_dispatch_resolution_deadline_missing",
    );
    let lookup:
      | Awaited<
          ReturnType<
            ReviewRequestedDispatchGatewayPort["findByRequestIdentity"]
          >
        >
      | undefined;
    try {
      lookup = await this.observe(intent, passDeadline, (signal) =>
        this.gateway.findByRequestIdentity({ intent, signal }),
      );
    } catch {
      lookup = {
        status: ReviewRequestedDispatchLookupStatus.Inconclusive,
      };
    }
    const now = this.clock.now();
    if (lookup.status === ReviewRequestedDispatchLookupStatus.Found) {
      const claim = intent.claim;
      if (claim === null) return "failed";
      const linked = await this.commands.recordDispatch({
        requestId: intent.requestId,
        claimId: claim.claimId,
        ownerIdHash: claim.ownerIdHash,
        fencingToken: claim.fencingToken,
        sourceRunId: lookup.sourceRunId,
        sourceRunAttempt: lookup.sourceRunAttempt,
        now,
        nextResolutionAt: new Date(
          now.getTime() + this.policy.authorizationResolutionDelayMs,
        ),
        resolutionDeadlineAt: new Date(
          now.getTime() + this.policy.authorizationResolutionTimeoutMs,
        ),
      });
      return transitionApplied(linked.status) ? "recovered" : "failed";
    }
    if (now >= deadline) {
      const terminalized = await this.commands.recoverDispatch({
        requestId: intent.requestId,
        expectedVersion: intent.version,
        sourceRunId: null,
        sourceRunAttempt: null,
        now,
        terminalReason:
          ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
        successorCandidate: null,
      });
      return transitionApplied(terminalized.status) ? "recovered" : "failed";
    }
    return this.defer(intent, now, deadline);
  }

  private async resolveAwaitingAuthorization(
    intent: ReviewRequestedIntent,
    passDeadline: number,
  ): Promise<CandidateResolution> {
    const deadline = requiredDate(
      intent.resolutionDeadlineAt,
      "review_requested_authorization_deadline_missing",
    );
    const runStatus = await this.observe(intent, passDeadline, (signal) =>
      this.gateway.inspectKnownRun({ intent, signal }),
    )
      .then((inspection) => inspection.status)
      .catch((): ReviewRequestedDispatchRunStatus | null => null);
    const now = this.clock.now();
    if (
      runStatus === ReviewRequestedDispatchRunStatus.TerminalCurrentRevision
    ) {
      const sourceRunId = requiredSourceIdentity(
        intent.sourceRunId,
        "review_requested_recovery_source_run_missing",
      );
      const sourceRunAttempt = requiredSourceIdentity(
        intent.sourceRunAttempt,
        "review_requested_recovery_source_attempt_missing",
      );
      const successor = await buildReviewRequestedRetryCandidate({
        intent,
        now,
        identitySeed: `${sourceRunId}\0${sourceRunAttempt}`,
        dependencies: this.retryDependencies,
        policy: this.policy,
      });
      const recovered = await this.commands.recoverDispatch({
        requestId: intent.requestId,
        expectedVersion: intent.version,
        sourceRunId,
        sourceRunAttempt,
        now,
        terminalReason:
          successor === null
            ? ReviewRequestedIntentTerminalReason.DispatchAttemptsExhausted
            : ReviewRequestedIntentTerminalReason.DispatchFailedNoEffect,
        successorCandidate: successor,
      });
      return transitionApplied(recovered.status) ? "recovered" : "failed";
    }
    if (
      runStatus === ReviewRequestedDispatchRunStatus.TerminalStaleRevision ||
      runStatus === ReviewRequestedDispatchRunStatus.TerminalNotRetryable
    ) {
      // Stop this request without a successor. A newer revision arrives through
      // ingress; an operator cancellation must not be undone by a redispatch.
      const recovered = await this.commands.recoverDispatch({
        requestId: intent.requestId,
        expectedVersion: intent.version,
        sourceRunId: requiredSourceIdentity(
          intent.sourceRunId,
          "review_requested_recovery_source_run_missing",
        ),
        sourceRunAttempt: requiredSourceIdentity(
          intent.sourceRunAttempt,
          "review_requested_recovery_source_attempt_missing",
        ),
        now,
        terminalReason: null,
        successorCandidate: null,
      });
      return transitionApplied(recovered.status) ? "recovered" : "failed";
    }
    if (
      runStatus === ReviewRequestedDispatchRunStatus.Pending &&
      (await this.extendWhileWaitingForRunner(
        intent,
        now,
        deadline,
        passDeadline,
      ))
    ) {
      return "pending";
    }
    if (now < deadline) {
      return this.defer(intent, now, deadline);
    }

    const terminalized = await this.commands.recoverDispatch({
      requestId: intent.requestId,
      expectedVersion: intent.version,
      sourceRunId: requiredSourceIdentity(
        intent.sourceRunId,
        "review_requested_recovery_source_run_missing",
      ),
      sourceRunAttempt: requiredSourceIdentity(
        intent.sourceRunAttempt,
        "review_requested_recovery_source_attempt_missing",
      ),
      now,
      terminalReason:
        ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
      successorCandidate: null,
    });
    if (!transitionApplied(terminalized.status)) return "failed";
    try {
      await this.observe(intent, passDeadline, (signal) =>
        this.gateway.cancelKnownRun({ intent, signal }),
      );
    } catch {
      // Terminalization is authoritative. Cancellation is best effort because
      // the run may have completed concurrently or SCM may be unavailable.
    }
    return "recovered";
  }

  /**
   * Plan 88: a run that GitHub has not given a runner keeps its place in the
   * GitHub queue. In the last passes before its deadline the request gets one
   * more authorization window, but only when GitHub states that every job is
   * still queued without a runner and the pull request still shows the
   * revision. A passed deadline is never reopened, and any doubt stops the
   * request at its deadline as before.
   */
  private async extendWhileWaitingForRunner(
    intent: ReviewRequestedIntent,
    now: Date,
    deadline: Date,
    passDeadline: number,
  ): Promise<boolean> {
    if (
      reviewRequestedQueuedRunWaitExtension(
        intent,
        this.policy.authorizationResolutionTimeoutMs,
      ) === null ||
      now >= deadline ||
      deadline.getTime() - now.getTime() >
        Math.min(
          queuedRunExtensionPasses * this.policy.authorizationResolutionDelayMs,
          this.policy.authorizationResolutionTimeoutMs / 4,
        )
    ) {
      return false;
    }
    const runner = await this.observe(intent, passDeadline, (signal) =>
      this.gateway.inspectRunnerWait({ intent, signal }),
    ).catch(() => null);
    now = this.clock.now();
    if (now >= deadline) return false;
    if (!runner?.waitingForRunner || !runner.revisionCurrent) return false;
    const extended = await this.commands.extendQueuedRunWait({
      requestId: intent.requestId,
      expectedVersion: intent.version,
      now,
      windowMs: this.policy.authorizationResolutionTimeoutMs,
      nextResolutionAt: new Date(
        now.getTime() + this.policy.authorizationResolutionDelayMs,
      ),
    });
    return transitionApplied(extended.status);
  }

  private async observe<T>(
    intent: ReviewRequestedIntent,
    passDeadline: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const remainingMs = passDeadline - performance.now();
    if (
      remainingMs <= 0 ||
      this.observationsInFlight.has(intent.requestId) ||
      this.observationsInFlight.size >= maximumRecoveryObservationsInFlight
    ) {
      throw new Error("review_requested_recovery_observation_unavailable");
    }
    this.observationsInFlight.add(intent.requestId);
    return withReviewRequestedIoTimeout(
      Math.min(maximumRecoveryObservationMs, remainingMs),
      async (signal) => {
        try {
          return await work(signal);
        } finally {
          // Retain the slot when transport ignores abort, until real IO settles.
          this.observationsInFlight.delete(intent.requestId);
        }
      },
    );
  }

  private async defer(
    intent: ReviewRequestedIntent,
    now: Date,
    deadline: Date,
  ): Promise<CandidateResolution> {
    const deferred = await this.commands.deferResolution({
      requestId: intent.requestId,
      expectedVersion: intent.version,
      expectedState: intent.state as
        | ReviewRequestedIntentState.ReconcilingDispatch
        | ReviewRequestedIntentState.AwaitingAuthorization,
      now,
      nextResolutionAt: new Date(
        Math.min(
          deadline.getTime(),
          now.getTime() +
            (intent.state === ReviewRequestedIntentState.ReconcilingDispatch
              ? this.policy.dispatchResolutionDelayMs
              : this.policy.authorizationResolutionDelayMs),
        ),
      ),
    });
    return transitionApplied(deferred.status) ? "pending" : "failed";
  }
}

function transitionApplied(status: ReviewRequestedTransitionStatus): boolean {
  return (
    status === ReviewRequestedTransitionStatus.Applied ||
    status === ReviewRequestedTransitionStatus.Restored
  );
}

function requiredSourceIdentity(value: string | null, error: string): string {
  if (!value) throw new Error(error);
  return value;
}

function requiredDate(value: Date | null, error: string): Date {
  if (value === null) throw new Error(error);
  return value;
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000) {
    throw new Error("review_requested_recovery_limit_invalid");
  }
}

const maximumRecoveryObservationMs = 5_000;
const maximumRecoveryPassMs = 5_000;
const maximumRecoveryObservationsInFlight = 32;
