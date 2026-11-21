import { describe, expect, it, vi } from "vitest";
import {
  DispatchDueReviewRequestedIntents,
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedDispatchSubmissionStatus,
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedTransitionStatus,
  ReviewRequestedTriggerKind,
  reviewRequestedPreparationTimeoutMs,
} from "../index";
import { InMemoryReviewRequestedIntentStore } from "../testing/index";

const initial = new Date("2026-01-01T00:00:00Z");
const after = (ms: number) => new Date(initial.getTime() + ms);
const scope = {
  workspaceId: "workspace",
  repositoryConnectionId: "repository",
  scmRepositoryIdentityId: "identity",
  pullRequestNumber: 42,
};
const revision = {
  baseSha: "a".repeat(40),
  mergeBaseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  reviewRevisionHash: "d".repeat(64),
};
function candidate(id: string, seed: string) {
  return {
    ...scope,
    requestId: id,
    revision,
    triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
    deliveryIdentityHash: seed.repeat(64),
    canonicalRequestHash: seed.repeat(64),
    notBefore: initial,
    createdAt: initial,
    retainUntil: after(31 * 86400000),
  };
}
async function claim(
  store: InMemoryReviewRequestedIntentStore,
  id: string,
  at: Date,
  name: string,
) {
  const result = await store.claimIntent({
    requestId: id,
    claimId: name,
    ownerIdHash: "owner",
    now: at,
    claimUntil: new Date(at.getTime() + 60_000),
  });
  if (!result.intent?.claim) throw new Error("fixture_claim_missing");
  return {
    requestId: id,
    expectedVersion: result.intent.version,
    claimId: result.intent.claim.claimId,
    ownerIdHash: result.intent.claim.ownerIdHash,
    fencingToken: result.intent.claim.fencingToken,
  };
}

describe("pre-submission preparation recovery", () => {
  it.each(["accepted", "no-effect", "terminal"] as const)(
    "handles a POST result after observation ends (%s)",
    async (outcome) => {
      vi.useFakeTimers();
      try {
        const store = new InMemoryReviewRequestedIntentStore();
        await store.registerIntent({ candidate: candidate("late-post", "8") });
        let workerNow = initial;
        let release: (() => void) | undefined;
        let postSignal: AbortSignal | undefined;
        const post = vi.fn(async (signal?: AbortSignal) => {
          postSignal = signal;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return outcome === "no-effect"
            ? {
                status:
                  ReviewRequestedDispatchSubmissionStatus.DefinitelyNoEffect as const,
              }
            : {
                status:
                  ReviewRequestedDispatchSubmissionStatus.Accepted as const,
                sourceRunId: "123",
                sourceRunAttempt: "1",
              };
        });
        const dispatcher = new DispatchDueReviewRequestedIntents(
          store,
          store,
          {
            async prepare() {
              return { submit: post };
            },
            async findByRequestIdentity() {
              return {
                status: ReviewRequestedDispatchLookupStatus.Absent as const,
              };
            },
            async inspectKnownRun() {
              return { status: ReviewRequestedDispatchRunStatus.Pending };
            },
            async inspectRunnerWait() {
              return {
                waitingForRunner: false,
                neverStarted: false,
                revisionCurrent: true,
              };
            },
            async cancelKnownRun() {},
          },
          { now: () => workerNow },
          {
            nextClaimId: () => "claim-late",
            nextRequestId: () => "should-not-exist",
          },
          { digestUtf8: async () => "a".repeat(64) },
        );
        const pass = dispatcher.execute({
          ownerIdHash: "a".repeat(64),
          limit: 10,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(pass).resolves.toMatchObject({
          failed: 1,
          submissionsInFlight: 1,
        });
        expect(postSignal?.aborted).toBe(false);
        if (outcome === "terminal") {
          workerNow = after(300_001);
          const current = (await store.findByRequestId("late-post"))!;
          await expect(
            store.recoverDispatch({
              requestId: "late-post",
              expectedVersion: current.version,
              sourceRunId: null,
              sourceRunAttempt: null,
              now: workerNow,
              terminalReason:
                ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
              successorCandidate: null,
            }),
          ).resolves.toMatchObject({
            status: ReviewRequestedTransitionStatus.Applied,
          });
        } else {
          await vi.advanceTimersByTimeAsync(2_000);
          workerNow = after(7_000);
        }
        release!();
        await vi.advanceTimersByTimeAsync(0);
        const state = await store.findByRequestId("late-post");
        if (outcome === "accepted")
          expect(state).toMatchObject({
            state: ReviewRequestedIntentState.AwaitingAuthorization,
            sourceRunId: "123",
          });
        if (outcome === "no-effect")
          expect(state).toMatchObject({
            state: ReviewRequestedIntentState.ReconcilingDispatch,
            sourceRunId: null,
          });
        if (outcome === "terminal")
          expect(state).toMatchObject({
            state: ReviewRequestedIntentState.Terminal,
            terminalReason:
              ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
            sourceRunId: null,
          });
        expect(post).toHaveBeenCalledTimes(1);
        expect(await store.findByRequestId("should-not-exist")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("does not begin another durable submission when hung POST slots are full", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryReviewRequestedIntentStore();
      for (let i = 0; i < 33; i++) {
        const seed = (i + 1).toString(16).padStart(64, "0");
        await store.registerIntent({
          candidate: {
            ...candidate(`post-${String(i).padStart(2, "0")}`, "1"),
            pullRequestNumber: i + 1,
            deliveryIdentityHash: seed,
            canonicalRequestHash: seed,
          },
        });
      }
      let sequence = 0;
      const post = vi.fn(() => new Promise<never>(() => {}));
      const dispatcher = new DispatchDueReviewRequestedIntents(
        store,
        store,
        {
          async prepare() {
            return { submit: post };
          },
          async findByRequestIdentity() {
            return {
              status: ReviewRequestedDispatchLookupStatus.Absent as const,
            };
          },
          async inspectKnownRun() {
            return { status: ReviewRequestedDispatchRunStatus.Pending };
          },
          async inspectRunnerWait() {
            return {
              waitingForRunner: false,
              neverStarted: false,
              revisionCurrent: true,
            };
          },
          async cancelKnownRun() {},
        },
        { now: () => initial },
        {
          nextClaimId: () => `post-claim-${sequence++}`,
          nextRequestId: () => `next-${sequence++}`,
        },
        { digestUtf8: async () => "a".repeat(64) },
      );
      for (let i = 0; i < 4; i++) {
        const pass = dispatcher.execute({
          ownerIdHash: "a".repeat(64),
          limit: 10,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await pass;
        if (i === 3)
          expect(result).toMatchObject({
            submissionSaturated: true,
            submissionsInFlight: 32,
          });
      }
      expect(post).toHaveBeenCalledTimes(32);
      expect(await store.findByRequestId("post-32")).toMatchObject({
        state: ReviewRequestedIntentState.Dispatching,
        submissionStartedAt: null,
      });
      expect(await store.findByRequestId("post-00")).toMatchObject({
        state: ReviewRequestedIntentState.ReconcilingDispatch,
        sourceRunId: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds non-cooperative preparations, reports saturation and expires an abandoned request", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryReviewRequestedIntentStore();
      for (let i = 0; i < 33; i++) {
        const seed = (i + 1).toString(16).padStart(64, "0");
        await store.registerIntent({
          candidate: {
            ...candidate(`stuck-${i}`, "1"),
            pullRequestNumber: i + 1,
            deliveryIdentityHash: seed,
            canonicalRequestHash: seed,
          },
        });
      }
      let at = initial;
      let sequence = 0;
      const prepare = vi.fn(() => new Promise<never>(() => {}));
      const dispatcher = new DispatchDueReviewRequestedIntents(
        store,
        store,
        {
          prepare,
          async findByRequestIdentity() {
            return {
              status: ReviewRequestedDispatchLookupStatus.Absent as const,
            };
          },
          async inspectKnownRun() {
            return { status: ReviewRequestedDispatchRunStatus.Pending };
          },
          async inspectRunnerWait() {
            return {
              waitingForRunner: false,
              neverStarted: false,
              revisionCurrent: true,
            };
          },
          async cancelKnownRun() {},
        },
        { now: () => at },
        {
          nextClaimId: () => `claim-${sequence++}`,
          nextRequestId: () => `next-${sequence++}`,
        },
        { digestUtf8: async () => "a".repeat(64) },
      );
      for (let i = 0; i < 4; i++) {
        const pass = dispatcher.execute({
          ownerIdHash: "a".repeat(64),
          limit: 10,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await pass;
        if (i === 3)
          expect(result).toMatchObject({
            preparationSaturated: true,
            preparationsInFlight: 32,
          });
      }
      expect(prepare).toHaveBeenCalledTimes(32);
      const saturated = await dispatcher.execute({
        ownerIdHash: "a".repeat(64),
        limit: 10,
      });
      expect(saturated).toMatchObject({
        preparationSaturated: true,
        preparationsInFlight: 32,
        failed: 1,
      });
      expect(prepare).toHaveBeenCalledTimes(32);
      at = after(reviewRequestedPreparationTimeoutMs + 1);
      await dispatcher.execute({ ownerIdHash: "a".repeat(64), limit: 10 });
      expect(await store.findByRequestId("stuck-0")).toMatchObject({
        state: ReviewRequestedIntentState.Terminal,
        terminalReason:
          ReviewRequestedIntentTerminalReason.DispatchFailedNoEffect,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("starts the window at the first claim and expires even if preparation never returns", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    await store.registerIntent({ candidate: candidate("old", "1") });
    const firstAt = after(10 * 86400000);
    await claim(store, "old", firstAt, "claim-1");
    await expect(store.findByRequestId("old")).resolves.toMatchObject({
      state: ReviewRequestedIntentState.Dispatching,
      resolutionDeadlineAt: new Date(
        firstAt.getTime() + reviewRequestedPreparationTimeoutMs,
      ),
    });
    const secondAt = new Date(firstAt.getTime() + 60_001);
    await claim(store, "old", secondAt, "claim-2");
    const expiredAt = new Date(
      firstAt.getTime() + reviewRequestedPreparationTimeoutMs + 1,
    );
    const expired = await store.claimIntent({
      requestId: "old",
      claimId: "claim-3",
      ownerIdHash: "owner",
      now: expiredAt,
      claimUntil: new Date(expiredAt.getTime() + 60_000),
    });
    expect(expired).toMatchObject({
      status: "preparation_expired",
      intent: {
        state: ReviewRequestedIntentState.Terminal,
        terminalReason:
          ReviewRequestedIntentTerminalReason.DispatchFailedNoEffect,
        submissionStartedAt: null,
      },
    });
  });

  it("a successful submission replaces the preparation deadline", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    await store.registerIntent({ candidate: candidate("recovered", "2") });
    const at = after(reviewRequestedPreparationTimeoutMs - 90_000);
    await claim(store, "recovered", initial, "claim-1");
    const next = await claim(store, "recovered", at, "claim-2");
    const deadline = new Date(at.getTime() + 300_000);
    await expect(
      store.beginSubmission({
        ...next,
        now: at,
        nextResolutionAt: new Date(at.getTime() + 30_000),
        resolutionDeadlineAt: deadline,
      }),
    ).resolves.toMatchObject({
      status: ReviewRequestedTransitionStatus.Applied,
      intent: {
        state: ReviewRequestedIntentState.ReconcilingDispatch,
        submissionStartedAt: at,
        resolutionDeadlineAt: deadline,
      },
    });
  });

  it("rejects an expired or replaced claim and never stops a newer request in the same scope", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    await store.registerIntent({ candidate: candidate("older", "3") });
    const old = await claim(store, "older", initial, "claim-1");
    await store.registerIntent({ candidate: candidate("newer", "4") });
    const at = after(60_001);
    const current = await claim(store, "older", at, "claim-2");
    await expect(
      store.resolvePreparation({ ...old, now: at }),
    ).resolves.toMatchObject({
      status: ReviewRequestedTransitionStatus.StaleClaim,
    });
    await expect(
      store.resolvePreparation({ ...current, now: at }),
    ).resolves.toMatchObject({
      status: ReviewRequestedTransitionStatus.Applied,
      intent: { state: ReviewRequestedIntentState.Superseded },
    });
    await expect(store.findByRequestId("newer")).resolves.toMatchObject({
      state: ReviewRequestedIntentState.PendingDispatch,
    });
    await expect(store.findPendingByScope(scope)).resolves.toMatchObject({
      requestId: "newer",
    });
  });

  it("expires an old no-effect claim even when a newer request owns the same lane", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    await store.registerIntent({ candidate: candidate("lane-old", "6") });
    await claim(store, "lane-old", initial, "old-owner");
    await store.registerIntent({ candidate: candidate("lane-new", "7") });
    const at = after(reviewRequestedPreparationTimeoutMs + 1);
    const current = await claim(store, "lane-new", at, "new-owner");
    const expired = await store.claimIntent({
      requestId: "lane-old",
      claimId: "reclaimer",
      ownerIdHash: "owner",
      now: at,
      claimUntil: new Date(at.getTime() + 60_000),
    });
    expect(expired.status).toBe("preparation_expired");
    await expect(
      store.beginSubmission({
        ...current,
        now: at,
        nextResolutionAt: new Date(at.getTime() + 1000),
        resolutionDeadlineAt: new Date(at.getTime() + 60000),
      }),
    ).resolves.toMatchObject({
      status: ReviewRequestedTransitionStatus.Applied,
    });
    expect(await store.findByRequestId("lane-old")).toMatchObject({
      state: ReviewRequestedIntentState.Terminal,
    });
    expect(await store.findByRequestId("lane-new")).toMatchObject({
      state: ReviewRequestedIntentState.ReconcilingDispatch,
    });
  });

  it("allows at most one of beginSubmission and stopping a claim", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    await store.registerIntent({ candidate: candidate("race", "5") });
    const term = await claim(store, "race", initial, "claim");
    const [begin, stop] = await Promise.all([
      store.beginSubmission({
        ...term,
        now: initial,
        nextResolutionAt: after(1000),
        resolutionDeadlineAt: after(60000),
      }),
      store.resolvePreparation({ ...term, now: initial }),
    ]);
    expect(
      [begin.status, stop.status].filter(
        (status) => status === ReviewRequestedTransitionStatus.Applied,
      ),
    ).toHaveLength(1);
    const current = await store.findByRequestId("race");
    expect(current?.state).toBe(ReviewRequestedIntentState.ReconcilingDispatch);
    expect(current?.submissionStartedAt).toEqual(initial);
  });
});
