import { describe, expect, it, vi } from "vitest";
import {
  createReviewRequestedIntent,
  decideReviewRequestedAdmission,
  decideReviewRequestedRegistration,
  ReviewRequestAdmissionState,
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedTriggerKind,
  reviewRequestedDispatchCleanupEvent,
  bindReviewRequestedDispatchCleanupTarget,
  ReviewRequestedTransitionDecisionStatus,
  ReviewRequestedTransitionStatus,
  type ReviewRequestedDispatchCleanupTargetPort,
  type ReviewRequestedDispatchGatewayPort,
  type ReviewRequestedIntent,
} from "@reviewrouter/features-review-executions";
import {
  InMemoryOutboxEventRepository,
  processOutboxBatch,
} from "@reviewrouter/features-outbox";
import { createReviewRequestedDispatchCleanupHandler } from "./review-v2-dispatch-cleanup-handler";

const start = new Date("2026-10-26T12:00:00Z");
function submittedIntent(): ReviewRequestedIntent {
  return {
    ...createReviewRequestedIntent({
      workspaceId: "workspace",
      repositoryConnectionId: "repository",
      scmRepositoryIdentityId: "scm",
      pullRequestNumber: 1,
      requestId: "request-old",
      triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
      revision: {
        baseSha: "a".repeat(40),
        mergeBaseSha: "b".repeat(40),
        headSha: "c".repeat(40),
        reviewRevisionHash: "d".repeat(64),
      },
      canonicalRequestHash: "e".repeat(64),
      deliveryIdentityHash: "f".repeat(64),
      notBefore: start,
      createdAt: start,
      retainUntil: new Date(start.getTime() + 86400000),
    }),
    state: ReviewRequestedIntentState.AwaitingAuthorization,
    submissionStartedAt: start,
    sourceRunId: "701",
    sourceRunAttempt: "1",
    resolutionDeadlineAt: new Date(start.getTime() + 1000),
    nextResolutionAt: start,
  };
}
function supersede(prior = submittedIntent()) {
  const decision = decideReviewRequestedRegistration({
    candidate: {
      ...prior,
      requestId: "request-new",
      deliveryIdentityHash: "1".repeat(64),
      createdAt: new Date(start.getTime() + 100),
      notBefore: new Date(start.getTime() + 100),
      revision: { ...prior.revision, headSha: "9".repeat(40) },
    },
    existingByDelivery: null,
    existingByRequestId: null,
    preAdmissionInScope: prior,
  });
  if (!("supersededIntent" in decision) || !decision.supersededIntent)
    throw new Error("fixture_not_superseded");
  return decision.supersededIntent;
}
async function fixture(intent = supersede()) {
  let now = new Date(start.getTime() + 2000); // Original dispatch deadline is already past.
  let terminal = false;
  const outbox = new InMemoryOutboxEventRepository();
  const event = reviewRequestedDispatchCleanupEvent(intent)!;
  await outbox.enqueue(event);
  const gateway = {
    prepare: vi.fn(),
    findByRequestIdentity: vi.fn(async () => ({
      status: ReviewRequestedDispatchLookupStatus.Found as const,
      sourceRunId: "701",
      sourceRunAttempt: "1",
    })),
    inspectKnownRun: vi.fn(async () => ({
      status: terminal
        ? ReviewRequestedDispatchRunStatus.TerminalStaleRevision
        : ReviewRequestedDispatchRunStatus.Pending,
    })),
    cancelKnownRun: vi.fn(async (input: { intent: ReviewRequestedIntent }) => {
      expect(input.intent.requestId).toBe("request-old");
      terminal = true;
    }),
  } satisfies ReviewRequestedDispatchGatewayPort;
  const intents = {
    findByRequestId: async () => intent,
    bindCleanupRunTarget: vi.fn(
      async (
        command: Parameters<
          ReviewRequestedDispatchCleanupTargetPort["bindCleanupRunTarget"]
        >[0],
      ) => {
        const decision = bindReviewRequestedDispatchCleanupTarget({
          ...command,
          intent,
          now,
        });
        if (decision.status === ReviewRequestedTransitionDecisionStatus.Applied)
          Object.assign(intent, decision.intent);
        return {
          status:
            decision.status === ReviewRequestedTransitionDecisionStatus.Applied
              ? ReviewRequestedTransitionStatus.Applied
              : decision.status ===
                  ReviewRequestedTransitionDecisionStatus.Restored
                ? ReviewRequestedTransitionStatus.Restored
                : ReviewRequestedTransitionStatus.Conflict,
          ...("intent" in decision ? { intent: decision.intent } : {}),
        };
      },
    ),
  };
  const handler = createReviewRequestedDispatchCleanupHandler({
    intents,
    gateway,
  });
  return {
    intent,
    intents,
    gateway,
    outbox,
    event,
    tick: async () => {
      const result = await processOutboxBatch(
        { limit: 1, handlers: [handler], claimOwnerHash: "a".repeat(64) },
        { outbox, clock: { now: () => now } },
      );
      now = new Date(now.getTime() + 300001);
      return result;
    },
  };
}

describe("durable superseded dispatch cleanup", () => {
  it("fences cleanup binding by lifecycle/version and never overwrites a known target", () => {
    const intent = {
      ...supersede(),
      sourceRunId: null,
      sourceRunAttempt: null,
    };
    const command = {
      intent,
      expectedVersion: intent.version,
      sourceRunId: "701",
      sourceRunAttempt: "1",
      now: start,
    };
    const bound = bindReviewRequestedDispatchCleanupTarget(command);
    expect(bound.status).toBe(ReviewRequestedTransitionDecisionStatus.Applied);
    if (!("intent" in bound)) throw new Error("fixture_binding_failed");
    expect(bound.intent).toMatchObject({
      sourceRunId: "701",
      sourceRunAttempt: "1",
      version: intent.version + 1n,
    });
    expect(intent.sourceRunId).toBeNull();
    expect(
      bindReviewRequestedDispatchCleanupTarget({
        ...command,
        intent: bound.intent,
      }).status,
    ).toBe(ReviewRequestedTransitionDecisionStatus.Restored);
    for (const change of [
      { sourceRunId: "702" },
      { sourceRunAttempt: "2" },
      { expectedVersion: bound.intent.version + 1n },
    ])
      expect(
        bindReviewRequestedDispatchCleanupTarget({
          ...command,
          intent: bound.intent,
          ...change,
        }).status,
      ).toBe(ReviewRequestedTransitionDecisionStatus.Conflict);
    for (const change of [
      { expectedVersion: intent.version - 1n },
      { expectedVersion: intent.version + 1n },
      { intent: { ...intent, submissionStartedAt: null } },
      { intent: { ...intent, authorizationId: "authorized" } },
      { intent: { ...intent, executionId: "execution" } },
      { intent: { ...intent, sourceRunId: "701" } },
      {
        intent: {
          ...intent,
          admission: {
            state: ReviewRequestAdmissionState.Admitted as const,
            changedLines: 1,
            maxChangedLines: 10,
            policySnapshotId: "policy",
            decisionHash: "a".repeat(64),
            checkedAt: start,
          },
        },
      },
    ])
      expect(
        bindReviewRequestedDispatchCleanupTarget({ ...command, ...change })
          .status,
      ).toBe(ReviewRequestedTransitionDecisionStatus.Conflict);
  });

  it("persists the first discovered target and never retargets a later retry", async () => {
    const f = await fixture({
      ...supersede(),
      sourceRunId: null,
      sourceRunAttempt: null,
    });
    const originalPayload = structuredClone(f.event.payload);
    f.gateway.findByRequestIdentity
      .mockResolvedValueOnce({
        status: ReviewRequestedDispatchLookupStatus.Found,
        sourceRunId: "701",
        sourceRunAttempt: "1",
      })
      .mockResolvedValue({
        status: ReviewRequestedDispatchLookupStatus.Found,
        sourceRunId: "702",
        sourceRunAttempt: "1",
      });
    f.gateway.cancelKnownRun.mockRejectedValueOnce(
      new Error("first_cancel_transport_lost"),
    );
    expect(await f.tick()).toMatchObject({ processed: 0, retried: 1 });
    expect(await f.tick()).toMatchObject({ processed: 1 });
    expect(
      f.gateway.cancelKnownRun.mock.calls.map(
        ([input]) => input.intent.sourceRunId,
      ),
    ).toEqual(["701", "701"]);
    expect(f.gateway.findByRequestIdentity).toHaveBeenCalledTimes(1);
    expect(f.intent.sourceRunId).toBe("701");
    expect(f.intents.bindCleanupRunTarget).toHaveBeenCalledTimes(1);
    expect(f.event.payload).toEqual(originalPayload);
    expect(f.event.payload).toMatchObject({
      sourceRunId: null,
      sourceRunAttempt: null,
    });
  });

  it.each([
    "throw",
    "conflict",
    "wrong-target",
    "wrong-request",
    "unchanged-version",
  ] as const)(
    "fails closed before inspection/cancellation when binding is not proven (%s)",
    async (mode) => {
      const f = await fixture({
        ...supersede(),
        sourceRunId: null,
        sourceRunAttempt: null,
      });
      if (mode === "throw")
        f.intents.bindCleanupRunTarget.mockRejectedValueOnce(
          new Error("database_unavailable"),
        );
      else
        f.intents.bindCleanupRunTarget.mockResolvedValueOnce({
          status:
            mode === "conflict"
              ? ReviewRequestedTransitionStatus.Conflict
              : ReviewRequestedTransitionStatus.Applied,
          intent: {
            ...f.intent,
            sourceRunId: mode === "wrong-target" ? "702" : "701",
            sourceRunAttempt: "1",
            requestId:
              mode === "wrong-request" ? "other-request" : f.intent.requestId,
            version:
              f.intent.version + (mode === "unchanged-version" ? 0n : 1n),
          },
        });
      expect(await f.tick()).toMatchObject({ processed: 0, retried: 1 });
      expect(f.gateway.inspectKnownRun).not.toHaveBeenCalled();
      expect(f.gateway.cancelKnownRun).not.toHaveBeenCalled();
    },
  );

  it("rejects mixed or changed original event target identities", async () => {
    for (const payload of [
      { sourceRunId: null, sourceRunAttempt: "1" },
      { sourceRunId: "702", sourceRunAttempt: "1" },
    ]) {
      const f = await fixture();
      Object.assign(f.event.payload, payload);
      expect(await f.tick()).toMatchObject({ deadLettered: 1, processed: 0 });
      expect(f.gateway.inspectKnownRun).not.toHaveBeenCalled();
      expect(f.gateway.cancelKnownRun).not.toHaveBeenCalled();
    }
  });
  it.each([
    ReviewRequestedIntentTerminalReason.AuthorizationDeadlineExceeded,
    ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
  ])(
    "cleans terminal unresolved external work (%s)",
    async (terminalReason) => {
      const f = await fixture({
        ...submittedIntent(),
        state: ReviewRequestedIntentState.Terminal,
        terminalReason,
      });
      expect(await f.tick()).toMatchObject({ processed: 1 });
      expect(await f.tick()).toMatchObject({ claimed: 0 });
      expect(f.gateway.cancelKnownRun).toHaveBeenCalledTimes(1);
    },
  );

  it("excludes proven no-effect, exhausted and admitted terminal work", () => {
    for (const terminalReason of [
      ReviewRequestedIntentTerminalReason.DispatchFailedNoEffect,
      ReviewRequestedIntentTerminalReason.DispatchAttemptsExhausted,
    ]) {
      expect(
        reviewRequestedDispatchCleanupEvent({
          ...submittedIntent(),
          state: ReviewRequestedIntentState.Terminal,
          terminalReason,
        }),
      ).toBeNull();
    }
    const eligible = {
      ...submittedIntent(),
      state: ReviewRequestedIntentState.Terminal,
      terminalReason:
        ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
    };
    expect(
      reviewRequestedDispatchCleanupEvent({
        ...eligible,
        submissionStartedAt: null,
      }),
    ).toBeNull();
    expect(
      reviewRequestedDispatchCleanupEvent({
        ...eligible,
        authorizationId: "authorized",
      }),
    ).toBeNull();
    expect(
      reviewRequestedDispatchCleanupEvent({
        ...eligible,
        executionId: "execution",
      }),
    ).toBeNull();
    expect(
      reviewRequestedDispatchCleanupEvent({
        ...eligible,
        admission: {
          state: ReviewRequestAdmissionState.Admitted,
          changedLines: 1,
          maxChangedLines: 10,
          policySnapshotId: "policy",
          decisionHash: "a".repeat(64),
          checkedAt: start,
        },
      }),
    ).toBeNull();
  });

  it("retries a lost cancel response and acknowledges only terminal readback, with no duplicate effect", async () => {
    const f = await fixture();
    f.gateway.cancelKnownRun.mockRejectedValueOnce(new Error("transport_lost"));
    expect(await f.tick()).toMatchObject({ retried: 1, processed: 0 });
    expect(await f.tick()).toMatchObject({ processed: 1 });
    expect(await f.tick()).toMatchObject({ claimed: 0 });
    expect(f.gateway.cancelKnownRun).toHaveBeenCalledTimes(2);
    expect(f.gateway.cancelKnownRun.mock.calls[1]![0].intent).toMatchObject({
      sourceRunId: "701",
      sourceRunAttempt: "1",
    });
  });

  it("recovers after cancellation took effect but terminal readback was lost", async () => {
    const f = await fixture();
    f.gateway.inspectKnownRun
      .mockResolvedValueOnce({
        status: ReviewRequestedDispatchRunStatus.Pending,
      })
      .mockRejectedValueOnce(new Error("lost_terminal_readback"));
    expect(await f.tick()).toMatchObject({ retried: 1, processed: 0 });
    expect(await f.tick()).toMatchObject({ processed: 1 });
    expect(f.gateway.cancelKnownRun).toHaveBeenCalledTimes(1);
  });

  it("waits for asynchronous terminal state even after cancel POST succeeds", async () => {
    const f = await fixture();
    f.gateway.cancelKnownRun.mockResolvedValueOnce(undefined);
    expect(await f.tick()).toMatchObject({ retried: 1, processed: 0 });
    expect([...f.outbox.events.values()][0]!.status).toBe("retry_wait");
  });

  it("reconciles a late dispatch after supersession and the original resolution deadline", async () => {
    const f = await fixture(
      supersede({
        ...submittedIntent(),
        state: ReviewRequestedIntentState.ReconcilingDispatch,
        sourceRunId: null,
        sourceRunAttempt: null,
      }),
    );
    f.gateway.findByRequestIdentity.mockResolvedValueOnce({
      status: ReviewRequestedDispatchLookupStatus.Absent,
    } as never);
    expect(await f.tick()).toMatchObject({ retried: 1, processed: 0 });
    expect(f.gateway.cancelKnownRun).not.toHaveBeenCalled();
    expect(await f.tick()).toMatchObject({ processed: 1 });
    expect(f.gateway.cancelKnownRun).toHaveBeenCalledTimes(1);
  });

  it("retains an unresolved POST as a bounded dead letter instead of claiming no effect", async () => {
    const f = await fixture(
      supersede({
        ...submittedIntent(),
        state: ReviewRequestedIntentState.ReconcilingDispatch,
        sourceRunId: null,
        sourceRunAttempt: null,
      }),
    );
    f.gateway.findByRequestIdentity.mockResolvedValue({
      status: ReviewRequestedDispatchLookupStatus.Absent,
    } as never);
    for (let attempt = 1; attempt < 20; attempt++)
      expect(await f.tick()).toMatchObject({ retried: 1 });
    expect(await f.tick()).toMatchObject({ deadLettered: 1, processed: 0 });
    expect(await f.tick()).toMatchObject({ claimed: 0 });
    expect([...f.outbox.events.values()][0]).toMatchObject({
      status: "dead_letter",
      lastErrorCode: "dispatch_cleanup_run_unresolved",
    });
    expect(f.gateway.cancelKnownRun).not.toHaveBeenCalled();
  });

  it("fails closed if the persisted request is already admitted when the event is read", async () => {
    const f = await fixture();
    Object.assign(f.intent, {
      admission: {
        state: ReviewRequestAdmissionState.Admitted,
        changedLines: 1,
        maxChangedLines: 100,
        policySnapshotId: "policy",
        decisionHash: "a".repeat(64),
        checkedAt: start,
      },
    });
    expect(await f.tick()).toMatchObject({ deadLettered: 1, processed: 0 });
    expect(f.gateway.cancelKnownRun).not.toHaveBeenCalled();
  });

  it("does not emit cleanup for unsubmitted or admitted work and rejects late admission after supersession", () => {
    expect(
      reviewRequestedDispatchCleanupEvent({
        ...supersede(),
        submissionStartedAt: null,
      }),
    ).toBeNull();
    const prior = {
      ...submittedIntent(),
      admission: {
        state: ReviewRequestAdmissionState.Admitted as const,
        changedLines: 1,
        maxChangedLines: 100,
        policySnapshotId: "policy",
        decisionHash: "a".repeat(64),
        checkedAt: start,
      },
    };
    const registration = decideReviewRequestedRegistration({
      candidate: {
        ...prior,
        requestId: "new",
        deliveryIdentityHash: "1".repeat(64),
      },
      existingByDelivery: null,
      existingByRequestId: null,
      preAdmissionInScope: prior,
    });
    expect(
      "supersededIntent" in registration && registration.supersededIntent,
    ).toBeNull();
    expect(reviewRequestedDispatchCleanupEvent(prior)).toBeNull();
    const intent = supersede();
    expect(
      decideReviewRequestedAdmission({
        intent,
        expectedVersion: intent.version,
        changedLines: 1,
        maxChangedLines: 100,
        policySnapshotId: "policy",
        decisionHash: "a".repeat(64),
        verdict: ReviewRequestAdmissionState.Admitted,
        now: start,
      }).status,
    ).toBe("conflict");
  });
});
