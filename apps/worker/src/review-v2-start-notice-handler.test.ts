import { describe, expect, it, vi } from "vitest";
import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedStartNotice,
  ReviewRequestedTriggerKind,
  reviewRequestedStartNoticeEvent,
  type ReviewRequestedIntent,
  type ReviewRequestedRunnerWaitInspection,
} from "@reviewrouter/features-review-executions";
import type { OutboxEvent } from "@reviewrouter/features-outbox";
import {
  createReviewRequestedStartNoticeHandler,
  type ReviewRequestedStartNoticePublisherPort,
} from "./review-v2-start-notice-handler";

const dispatchedAt = new Date("2026-11-21T10:00:00.000Z");
const noRunner: ReviewRequestedRunnerWaitInspection = {
  waitingForRunner: true,
  neverStarted: true,
  revisionCurrent: true,
};

describe("review requested start notice handler", () => {
  it("tells the pull request that the review waits for a runner", async () => {
    const f = fixture(waiting());
    await f.handle();
    expect(f.publish).toHaveBeenCalledWith({
      intent: f.intent,
      notice: ReviewRequestedStartNotice.WaitingForRunner,
    });
  });

  it("tells the pull request that the review did not start", async () => {
    const f = fixture(notStarted(), {
      ...noRunner,
      waitingForRunner: false,
    });
    await f.handle();
    expect(f.publish).toHaveBeenCalledWith({
      intent: f.intent,
      notice: ReviewRequestedStartNotice.NotStarted,
    });
  });

  it.each([
    ["a job got a runner", waiting(), { ...noRunner, waitingForRunner: false }],
    [
      "the run had a runner before it stopped",
      notStarted(),
      { ...noRunner, waitingForRunner: false, neverStarted: false },
    ],
    [
      "the pull request moved",
      waiting(),
      { ...noRunner, revisionCurrent: false },
    ],
  ] as const)("stays silent when %s", async (_name, intent, runner) => {
    const f = fixture(intent, runner);
    await f.handle();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it("stays silent when a newer review request exists for the pull request", async () => {
    const f = fixture(waiting(), noRunner, { newer: true });
    await f.handle();
    expect(f.inspectRunnerWait).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it("stays silent once the request moved past the state the notice describes", async () => {
    // A waiting notice processed after the run reached authorization, or after
    // the request stopped, describes nothing true any more.
    const event = outboxEvent(waiting());
    for (const later of [
      { ...waiting(), state: ReviewRequestedIntentState.Dispatched },
      notStarted(),
    ]) {
      const f = fixture(later as ReviewRequestedIntent);
      await f.handler.handle(event);
      expect(f.publish).not.toHaveBeenCalled();
    }
  });

  it("stays silent when progress comment writes are off", async () => {
    const f = fixture(waiting(), noRunner, { publisherOff: true });
    await f.handle();
    expect(f.inspectRunnerWait).not.toHaveBeenCalled();
  });

  it("retries while live progress of the pull request is being published", async () => {
    const f = fixture(waiting(), noRunner, { busy: true });
    await expect(f.handle()).rejects.toMatchObject({
      code: "start_notice_progress_busy",
      retryable: true,
    });
  });
});

function fixture(
  intent: ReviewRequestedIntent,
  runner: ReviewRequestedRunnerWaitInspection = noRunner,
  options: { newer?: boolean; busy?: boolean; publisherOff?: boolean } = {},
) {
  const publish = vi.fn<ReviewRequestedStartNoticePublisherPort["publish"]>(
    async () => (options.busy ? "busy" : "published"),
  );
  const inspectRunnerWait = vi.fn(async () => runner);
  const handler = createReviewRequestedStartNoticeHandler({
    intents: {
      findByRequestId: async () => intent,
      hasNewerRequestInScope: async () => options.newer ?? false,
    },
    gateway: { inspectRunnerWait },
    publisher: options.publisherOff ? null : { publish },
  });
  return {
    intent,
    handler,
    publish,
    inspectRunnerWait,
    handle: () => handler.handle(outboxEvent(intent)),
  };
}

function outboxEvent(intent: ReviewRequestedIntent): OutboxEvent {
  const event = reviewRequestedStartNoticeEvent(intent);
  if (!event) throw new Error("fixture_has_no_notice");
  return {
    ...event,
    id: "event-1",
    status: "processing",
    attempts: 1,
    nextAttemptAt: null,
    claimId: "claim-1",
    claimVersion: 1n,
    claimOwnerHash: "owner-1",
    claimUntil: null,
  };
}

function notStarted(): ReviewRequestedIntent {
  return {
    ...waiting(),
    state: ReviewRequestedIntentState.Terminal,
    nextResolutionAt: null,
    resolutionDeadlineAt: new Date(dispatchedAt.getTime() + 5_400_000),
    terminalReason:
      ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
  };
}

function waiting(): ReviewRequestedIntent {
  return {
    workspaceId: "workspace-1",
    repositoryConnectionId: "connection-1",
    scmRepositoryIdentityId: "repository-1",
    pullRequestNumber: 42,
    requestId: "request-1",
    historyRootRequestId: "request-1",
    dispatchAttempt: 1,
    version: 6n,
    revision: {
      baseSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      reviewRevisionHash: "d".repeat(64),
    },
    triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
    deliveryIdentityHash: "e".repeat(64),
    canonicalRequestHash: "f".repeat(64),
    state: ReviewRequestedIntentState.AwaitingAuthorization,
    notBefore: dispatchedAt,
    claim: null,
    submissionStartedAt: dispatchedAt,
    nextResolutionAt: new Date(dispatchedAt.getTime() + 1_710_000),
    resolutionDeadlineAt: new Date(dispatchedAt.getTime() + 3_600_000),
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
