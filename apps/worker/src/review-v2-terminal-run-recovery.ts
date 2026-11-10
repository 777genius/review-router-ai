import { ReviewExecutionLifecycleTransitionStatus } from "@reviewrouter/features-review-executions";
import type {
  PrismaReviewExecutionStore,
  PrismaReviewRequestedIntentStore,
} from "@reviewrouter/features-review-executions/composition";
import type { GitHubActionsReviewRequestedDispatchGateway } from "./review-v2-intent-dispatcher";

/** Reconcile denied executions only after the exact App-owned workflow attempt failed.
 * The store rechecks revoked authority, source identity and stream version atomically.
 */
export class ReviewV2TerminalRunRecovery {
  private after = "";
  private inspectionInFlight: Promise<boolean> | null = null;
  constructor(
    private readonly executions: Pick<
      PrismaReviewExecutionStore,
      "listRevokedRunning" | "failObservedTerminalRunningExecution"
    >,
    private readonly intents: Pick<
      PrismaReviewRequestedIntentStore,
      "findBySourceRunIdentity"
    >,
    private readonly gateway: Pick<
      GitHubActionsReviewRequestedDispatchGateway,
      "isFailedTerminalAttempt"
    >,
    private readonly clock: { now(): Date },
  ) {}
  async execute(input: { readonly limit: number }) {
    const limit = Math.min(input.limit, 6);
    const before = new Date(this.clock.now().getTime() - 120_000);
    let candidates = await this.executions.listRevokedRunning({
      before,
      after: this.after,
      limit,
    });
    if (!candidates.length && this.after) {
      this.after = "";
      candidates = await this.executions.listRevokedRunning({
        before,
        after: this.after,
        limit,
      });
    }
    this.after = candidates.at(-1)?.execution.executionId ?? "";
    let recovered = 0,
      conflicts = 0,
      failures = 0;
    for (const candidate of candidates) {
      const e = candidate.execution;
      try {
        const intent = await this.intents.findBySourceRunIdentity(e);
        if (
          !intent ||
          intent.authorizationId !== e.authorizationId ||
          intent.executionId !== e.executionId ||
          !(await this.inspectAttempt(intent))
        )
          continue;
        const result =
          await this.executions.failObservedTerminalRunningExecution({
            scope: e,
            executionId: e.executionId,
            expectedStreamVersion: candidate.stream.version,
            sourceRunId: e.sourceRunId,
            sourceRunAttempt: e.sourceRunAttempt,
            authorizationId: e.authorizationId,
            now: this.clock.now(),
          });
        if (
          result.status === ReviewExecutionLifecycleTransitionStatus.Applied ||
          result.status === ReviewExecutionLifecycleTransitionStatus.Restored
        )
          recovered++;
        else conflicts++;
      } catch {
        failures++;
      }
    }
    return { scanned: candidates.length, recovered, conflicts, failures };
  }

  private async inspectAttempt(
    intent: Parameters<
      GitHubActionsReviewRequestedDispatchGateway["isFailedTerminalAttempt"]
    >[0]["intent"],
  ): Promise<boolean> {
    // A hung installation-token request must not block the worker or accumulate
    // more requests. Its late result never authorizes a lifecycle transition.
    // Only this recovery is paused until the request settles or the worker restarts.
    if (this.inspectionInFlight) return false;
    const pending = Promise.resolve().then(() =>
      this.gateway.isFailedTerminalAttempt({ intent }),
    );
    this.inspectionInFlight = pending;
    void pending.then(
      () => {
        this.inspectionInFlight = null;
      },
      () => {
        this.inspectionInFlight = null;
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
