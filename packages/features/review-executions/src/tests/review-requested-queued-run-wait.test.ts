import { describe, expect, it, vi } from "vitest";
import {
  extendReviewRequestedQueuedRunWait,
  RecoverReviewRequestedDispatches,
  ReviewRequestAdmissionState,
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedStartNotice,
  ReviewRequestedTransitionDecisionStatus,
  ReviewRequestedTriggerKind,
  reviewRequestedStartNoticeEvent,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntent,
  type ReviewRequestedRunnerWaitInspection,
} from "../index";
import { InMemoryReviewRequestedIntentStore } from "../infrastructure/memory/in-memory-review-requested-intent-store";

// Plan 88: a dispatched run that GitHub has not given a runner keeps its place
// in the GitHub queue for at most 90 minutes after dispatch.
const dispatchedAt = new Date("2026-11-21T10:00:00.000Z");
const minute = 60_000;
const windowMs = 30 * minute;
const scope = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "connection-1",
  scmRepositoryIdentityId: "repository-1",
  pullRequestNumber: 42,
};
const policy = {
  claimDurationMs: 60_000,
  dispatchResolutionDelayMs: 30_000,
  dispatchResolutionTimeoutMs: 300_000,
  authorizationResolutionDelayMs: 30_000,
  authorizationResolutionTimeoutMs: windowMs,
  retryDelayMs: 30_000,
  retentionMs: 86_400_000,
  maxDispatchAttempts: 3,
};
const queued: ReviewRequestedRunnerWaitInspection = {
  waitingForRunner: true,
  neverStarted: true,
  revisionCurrent: true,
};

describe("queued run wait (domain)", () => {
  it("extends an open window by one window, up to 90 minutes after dispatch", () => {
    const first = extend(awaiting(30), at(28));
    expect(first).toMatchObject({
      status: ReviewRequestedTransitionDecisionStatus.Applied,
      intent: { resolutionDeadlineAt: at(60), version: 5n },
    });
    const second = extend(awaiting(60), at(58));
    expect(second).toMatchObject({
      status: ReviewRequestedTransitionDecisionStatus.Applied,
      intent: { resolutionDeadlineAt: at(90) },
    });
    // The limit is reached: no third window, and no stub of a few minutes.
    expect(extend(awaiting(90), at(88)).status).toBe(
      ReviewRequestedTransitionDecisionStatus.Conflict,
    );
    expect(extend(awaiting(80), at(78)).status).toBe(
      ReviewRequestedTransitionDecisionStatus.Conflict,
    );
  });

  it("does not extend while another request of the pull request waits for its own run", () => {
    // A manual review command does not join the queued run; once this run
    // got a runner, both would run on the same revision.
    expect(extend(awaiting(30), at(28), true).status).toBe(
      ReviewRequestedTransitionDecisionStatus.Conflict,
    );
  });

  it("never reopens a passed deadline, where a newer request may already run", () => {
    expect(extend(awaiting(30), at(30)).status).toBe(
      ReviewRequestedTransitionDecisionStatus.Conflict,
    );
    expect(extend(awaiting(30), at(31)).status).toBe(
      ReviewRequestedTransitionDecisionStatus.Conflict,
    );
  });

  it.each([
    [
      "admission evaluated",
      {
        admission: {
          state: ReviewRequestAdmissionState.Admitted,
          changedLines: 1,
          maxChangedLines: 10,
          policySnapshotId: "policy-1",
          decisionHash: "1".repeat(64),
          checkedAt: at(20),
        },
      },
    ],
    ["authorization linked", { authorizationId: "authorization-1" }],
    ["execution linked", { executionId: "execution-1" }],
    ["state moved on", { state: ReviewRequestedIntentState.Dispatched }],
    ["other version", { version: 9n }],
  ] as const)("leaves a request alone when %s", (_name, change) => {
    const intent = { ...awaiting(30), ...change } as ReviewRequestedIntent;
    expect(
      extendReviewRequestedQueuedRunWait({
        intent,
        expectedVersion: 4n,
        competingPreAdmission: false,
        now: at(28),
        windowMs,
        nextResolutionAt: at(28.5),
      }).status,
    ).toBe(ReviewRequestedTransitionDecisionStatus.Conflict);
  });

  it("owes the pull request a waiting status, then a not-started status", () => {
    expect(reviewRequestedStartNoticeEvent(awaiting(60))).toMatchObject({
      idempotencyKey: `review.requested_start_notice:waiting_for_runner:request-1`,
      payload: {
        requestId: "request-1",
        notice: ReviewRequestedStartNotice.WaitingForRunner,
      },
    });
    expect(
      reviewRequestedStartNoticeEvent({
        ...awaiting(90),
        state: ReviewRequestedIntentState.Terminal,
        nextResolutionAt: null,
        terminalReason:
          ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
      }),
    ).toMatchObject({
      idempotencyKey: `review.requested_start_notice:not_started:request-1`,
    });
    expect(
      reviewRequestedStartNoticeEvent({
        ...awaiting(30),
        state: ReviewRequestedIntentState.Terminal,
        nextResolutionAt: null,
        terminalReason:
          ReviewRequestedIntentTerminalReason.DispatchAttemptsExhausted,
      }),
    ).toBeNull();
  });
});

describe("queued run wait (recovery)", () => {
  it("keeps a queued run for two more windows, then stops it at 90 minutes", async () => {
    const harness = await recoveryHarness(async () => queued);
    const deadlines = await harness.runUntil(at(100));

    expect(deadlines).toEqual([at(30), at(60), at(90)]);
    // One GitHub runner check per extension, none before the last passes.
    expect(harness.inspectRunnerWait).toHaveBeenCalledTimes(2);
    expect(harness.cancelKnownRun).toHaveBeenCalledTimes(1);
    expect(await harness.intent()).toMatchObject({
      state: ReviewRequestedIntentState.Terminal,
      terminalReason:
        ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
      resolutionDeadlineAt: at(90),
    });
  });

  it.each([
    ["a job got a runner", { ...queued, waitingForRunner: false }],
    ["the pull request moved", { ...queued, revisionCurrent: false }],
  ])("stops at the first deadline when %s", async (_name, inspection) => {
    const harness = await recoveryHarness(async () => inspection);
    expect(await harness.runUntil(at(40))).toEqual([at(30)]);
    expect(harness.inspectRunnerWait).toHaveBeenCalled();
    expect(harness.cancelKnownRun).toHaveBeenCalledTimes(1);
    expect(await harness.intent()).toMatchObject({
      state: ReviewRequestedIntentState.Terminal,
      terminalReason:
        ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
    });
  });

  it("stops at the first deadline when a manual request of the pull request is waiting", async () => {
    const harness = await recoveryHarness(async () => queued);
    await harness.registerManualRequest();
    expect(await harness.runUntil(at(40))).toEqual([at(30)]);
    expect((await harness.intent())?.terminalReason).toBe(
      ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
    );
  });

  it("fails closed when GitHub does not answer the runner check", async () => {
    const harness = await recoveryHarness(async () => {
      throw new Error("github_unavailable");
    });
    expect(await harness.runUntil(at(40))).toEqual([at(30)]);
    expect((await harness.intent())?.state).toBe(
      ReviewRequestedIntentState.Terminal,
    );
  });

  it("does not reopen the window after a worker that missed the last passes", async () => {
    const harness = await recoveryHarness(async () => queued);
    harness.setNow(at(27));
    await harness.recovery.execute({ limit: 10 });
    harness.setNow(at(31));
    await harness.recovery.execute({ limit: 10 });

    expect(harness.inspectRunnerWait).not.toHaveBeenCalled();
    expect(await harness.intent()).toMatchObject({
      state: ReviewRequestedIntentState.Terminal,
      resolutionDeadlineAt: at(30),
    });
  });
});

async function recoveryHarness(
  inspectRunnerWait: () => Promise<ReviewRequestedRunnerWaitInspection>,
) {
  const intents = new InMemoryReviewRequestedIntentStore();
  await intents.registerIntent({
    candidate: {
      ...scope,
      requestId: "request-1",
      revision: revision(),
      triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
      deliveryIdentityHash: "a".repeat(64),
      canonicalRequestHash: "b".repeat(64),
      notBefore: dispatchedAt,
      createdAt: dispatchedAt,
      retainUntil: new Date(dispatchedAt.getTime() + 86_400_000),
    },
  });
  const claimed = await intents.claimIntent({
    requestId: "request-1",
    claimId: "claim-1",
    ownerIdHash: "owner-1",
    now: dispatchedAt,
    claimUntil: at(1),
  });
  const claim = claimed.intent!.claim!;
  const term = {
    requestId: "request-1",
    claimId: claim.claimId,
    ownerIdHash: claim.ownerIdHash,
    fencingToken: claim.fencingToken,
    now: dispatchedAt,
  };
  await intents.beginSubmission({
    ...term,
    nextResolutionAt: at(0.5),
    resolutionDeadlineAt: at(5),
  });
  await intents.recordDispatch({
    ...term,
    sourceRunId: "701",
    sourceRunAttempt: "1",
    nextResolutionAt: at(0.5),
    resolutionDeadlineAt: at(30),
  });
  let now = dispatchedAt;
  const inspect = vi.fn(inspectRunnerWait);
  const cancel = vi.fn(async () => {});
  const gateway: ReviewRequestedDispatchGatewayPort = {
    prepare: vi.fn(),
    findByRequestIdentity: vi.fn(async () => ({
      status: ReviewRequestedDispatchLookupStatus.Absent as const,
    })),
    inspectKnownRun: vi.fn(async () => ({
      status: ReviewRequestedDispatchRunStatus.Pending,
    })),
    inspectRunnerWait: inspect,
    cancelKnownRun: cancel,
  };
  const recovery = new RecoverReviewRequestedDispatches(
    intents,
    intents,
    gateway,
    { now: () => now },
    {
      ids: { nextRequestId: () => "must-not-redispatch" },
      digest: {
        digestUtf8: async () => {
          throw new Error("must_not_redispatch");
        },
      },
    },
    policy,
  );
  const intent = () => intents.findByRequestId("request-1");
  return {
    recovery,
    /** A `/rr review` on the same head: it does not join the queued run. */
    async registerManualRequest() {
      await intents.registerIntent({
        candidate: {
          ...scope,
          requestId: "request-manual",
          revision: revision(),
          triggerKind: ReviewRequestedTriggerKind.ManualCommand,
          deliveryIdentityHash: "e".repeat(64),
          canonicalRequestHash: "f".repeat(64),
          notBefore: at(10),
          createdAt: at(10),
          retainUntil: new Date(dispatchedAt.getTime() + 86_400_000),
        },
      });
    },
    inspectRunnerWait: inspect,
    cancelKnownRun: cancel,
    intent,
    setNow(value: Date) {
      now = value;
    },
    /** Every 30 s pass until `end`; returns each distinct deadline seen. */
    async runUntil(end: Date): Promise<Date[]> {
      const deadlines: Date[] = [];
      for (let t = 0.5; at(t) <= end; t += 0.5) {
        now = at(t);
        await recovery.execute({ limit: 10 });
        const deadline = (await intent())?.resolutionDeadlineAt;
        if (deadline && deadlines.at(-1)?.getTime() !== deadline.getTime()) {
          deadlines.push(deadline);
        }
      }
      return deadlines;
    },
  };
}

function extend(
  intent: ReviewRequestedIntent,
  now: Date,
  competingPreAdmission = false,
) {
  return extendReviewRequestedQueuedRunWait({
    intent,
    expectedVersion: intent.version,
    competingPreAdmission,
    now,
    windowMs,
    nextResolutionAt: new Date(now.getTime() + 30_000),
  });
}

function awaiting(deadlineMinute: number): ReviewRequestedIntent {
  return {
    ...scope,
    requestId: "request-1",
    historyRootRequestId: "request-1",
    dispatchAttempt: 1,
    version: 4n,
    revision: revision(),
    triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
    deliveryIdentityHash: "a".repeat(64),
    canonicalRequestHash: "b".repeat(64),
    state: ReviewRequestedIntentState.AwaitingAuthorization,
    notBefore: dispatchedAt,
    claim: null,
    submissionStartedAt: dispatchedAt,
    nextResolutionAt: at(deadlineMinute - 1),
    resolutionDeadlineAt: at(deadlineMinute),
    sourceRunId: "701",
    sourceRunAttempt: "1",
    authorizationId: null,
    executionId: null,
    terminalReason: null,
    admission: {
      state: ReviewRequestAdmissionState.NotEvaluated,
      changedLines: null,
      maxChangedLines: null,
      policySnapshotId: null,
      decisionHash: null,
      checkedAt: null,
    },
    rerunPredecessorRequestId: null,
    supersededByRequestId: null,
    createdAt: dispatchedAt,
    updatedAt: dispatchedAt,
    retainUntil: new Date(dispatchedAt.getTime() + 86_400_000),
  };
}

function revision() {
  return {
    baseSha: "a".repeat(40),
    mergeBaseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    reviewRevisionHash: "d".repeat(64),
  };
}

function at(minutes: number): Date {
  return new Date(dispatchedAt.getTime() + minutes * minute);
}
