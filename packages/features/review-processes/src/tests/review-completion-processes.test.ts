import { describe, expect, it, vi } from "vitest";
import {
  ReviewCompletionSchedulerMode,
  composeReviewCompletionProcesses,
} from "../composition";
import {
  AdvanceReviewCompletionProcess,
  AdvanceReviewCompletionProcessStatus,
  RecoverMissingReviewCompletionProcesses,
  ReviewCompletionProcessCreateStatus,
  ReviewCompletionProcessState,
  ReviewCompletionSafeReason,
  ReviewCompletionPublicationOutcome,
  ReviewCompletionPublicationState,
  ReviewCompletionSnapshotOutcome,
  ReviewCompletionWakeupKind,
  ReviewExecutionCompletionCoverage,
  ScanDueReviewCompletionProcesses,
  type ReviewCompletionPublicationFacts,
} from "../index";
import {
  InMemoryReviewCompletionExecutionQuery,
  InMemoryReviewCompletionProcessRepository,
  InMemoryReviewCompletionPublicationPort,
  InMemoryReviewCompletionRecoveryFeed,
  InMemoryReviewCompletionSnapshotPort,
  MutableReviewCompletionClock,
  SequentialReviewCompletionIds,
} from "../testing";

const start = new Date("2026-07-22T12:00:00.000Z");
const retainUntil = new Date("2026-08-22T12:00:00.000Z");

describe("review completion processes", () => {
  it("creates idempotently and ignores duplicate or out-of-order wakeups", async () => {
    const repository = new InMemoryReviewCompletionProcessRepository();
    const first = await repository.createOrWake(createInput("execution-1"));
    const duplicate = await repository.createOrWake(createInput("execution-1"));
    const older = await repository.createOrWake({
      ...createInput("execution-1"),
      wakeupKind: ReviewCompletionWakeupKind.PublicationChanged,
      wakeupAt: new Date(start.getTime() - 1_000),
    });

    expect(first.status).toBe(ReviewCompletionProcessCreateStatus.Created);
    expect(duplicate.status).toBe(ReviewCompletionProcessCreateStatus.Restored);
    expect(older.status).toBe(ReviewCompletionProcessCreateStatus.Restored);
    expect(older.process).toMatchObject({
      processVersion: 1n,
      lastWakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
      finalizedArtifactId: "artifact-execution-1",
    });

    const conflict = await repository.createOrWake({
      ...createInput("execution-1"),
      finalizedArtifactId: "different-artifact",
    });
    expect(conflict.status).toBe(
      ReviewCompletionProcessCreateStatus.ArtifactConflict,
    );
  });

  it("publishes partial coverage and completes without advancing snapshot", async () => {
    const fixture = await createFixture(
      "partial",
      ReviewExecutionCompletionCoverage.Partial,
    );
    const requested = await fixture.advance.execute({
      executionId: "partial",
      ownerIdHash: "worker-a",
    });
    expect(requested).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.RetryDue,
      process: {
        state: ReviewCompletionProcessState.PublicationInProgress,
        publicationAttemptId: "publication-1",
      },
    });

    fixture.publications.seed(
      publication("partial", {
        publicationAttemptId: "publication-1",
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );
    fixture.clock.advance(1_000);
    const result = await fixture.advance.execute({
      executionId: "partial",
      ownerIdHash: "worker-b",
    });

    expect(result).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.PartialCompleted,
      process: {
        state: ReviewCompletionProcessState.PartialCompleted,
        publicationAttemptId: "publication-1",
        snapshotCommitReceiptId: null,
        nextActionAt: null,
      },
    });
    expect(fixture.publications.requestCalls).toBe(1);
    expect(fixture.snapshots.commitCalls).toBe(0);
  });

  it("fails closed before publication when coverage facts are ambiguous", async () => {
    const fixture = await createFixture(
      "ambiguous-coverage",
      "unknown" as ReviewExecutionCompletionCoverage,
    );

    await expect(
      fixture.advance.execute({
        executionId: "ambiguous-coverage",
        ownerIdHash: "worker-a",
      }),
    ).resolves.toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.RetryDue,
      process: {
        state: ReviewCompletionProcessState.AwaitingPublication,
      },
    });
    expect(fixture.publications.requestCalls).toBe(0);
    expect(fixture.snapshots.commitCalls).toBe(0);
  });

  it("terminalizes published partial coverage already awaiting snapshot without repeating publication", async () => {
    const fixture = await createFixture("coverage-conflict");
    fixture.publications.seed(
      publication("coverage-conflict", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );
    await fixture.advance.execute({
      executionId: "coverage-conflict",
      ownerIdHash: "worker-a",
    });
    fixture.executions.seed({
      executionId: "coverage-conflict",
      finalizedArtifactId: "artifact-coverage-conflict",
      coverage: ReviewExecutionCompletionCoverage.Partial,
    });

    await expect(
      fixture.advance.execute({
        executionId: "coverage-conflict",
        ownerIdHash: "worker-b",
      }),
    ).resolves.toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.PartialCompleted,
      process: {
        state: ReviewCompletionProcessState.PartialCompleted,
        nextActionAt: null,
        snapshotCommitReceiptId: null,
        lastSafeReason: ReviewCompletionSafeReason.PartialCoveragePublished,
      },
    });
    expect(fixture.snapshots.commitCalls).toBe(0);
    expect(fixture.publications.requestCalls).toBe(0);
    fixture.clock.advance(60_000);
    expect(
      await fixture.advance.execute({
        executionId: "coverage-conflict",
        ownerIdHash: "worker-c",
      }),
    ).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.PartialCompleted,
    });
    expect(fixture.snapshots.commitCalls).toBe(0);
    expect(fixture.publications.requestCalls).toBe(0);
  });

  it.each([
    {
      outcome: ReviewCompletionPublicationOutcome.TerminalUnknown,
      publicationAttemptId: "publication-partial-publication-unknown",
      status: AdvanceReviewCompletionProcessStatus.BlockedPublicationUnknown,
      state: ReviewCompletionProcessState.BlockedPublicationUnknown,
      reason: ReviewCompletionSafeReason.PublicationTerminalUnknown,
    },
    {
      outcome: ReviewCompletionPublicationOutcome.Succeeded,
      publicationAttemptId: "publication-unavailable",
      status: AdvanceReviewCompletionProcessStatus.RetryDue,
      state: ReviewCompletionProcessState.AwaitingSnapshot,
      reason: ReviewCompletionSafeReason.PublicationOutcomeUnavailable,
    },
  ])("guards partial recovery: $reason", async (expected) => {
    const fixture = await createFixture("partial-publication-unknown");
    fixture.publications.seed(
      publication("partial-publication-unknown", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );
    await fixture.advance.execute({
      executionId: "partial-publication-unknown",
      ownerIdHash: "worker-a",
    });
    fixture.executions.seed({
      executionId: "partial-publication-unknown",
      finalizedArtifactId: "artifact-partial-publication-unknown",
      coverage: ReviewExecutionCompletionCoverage.Partial,
    });
    fixture.publications.seed(
      publication("partial-publication-unknown", {
        publicationAttemptId: expected.publicationAttemptId,
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: expected.outcome,
      }),
    );
    await expect(
      fixture.advance.execute({
        executionId: "partial-publication-unknown",
        ownerIdHash: "worker-b",
      }),
    ).resolves.toMatchObject({
      status: expected.status,
      process: {
        state: expected.state,
        lastSafeReason: expected.reason,
      },
    });
    expect(fixture.snapshots.commitCalls).toBe(0);
    expect(fixture.publications.requestCalls).toBe(0);
  });

  it("advances successful publication to a committed snapshot", async () => {
    const fixture = await createFixture("completed");
    fixture.publications.seed(
      publication("completed", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );

    const publicationResult = await fixture.advance.execute({
      executionId: "completed",
      ownerIdHash: "worker-a",
    });
    expect(publicationResult).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.Advanced,
      process: {
        state: ReviewCompletionProcessState.AwaitingSnapshot,
        publicationAttemptId: "publication-completed",
      },
    });

    const snapshot = await fixture.advance.execute({
      executionId: "completed",
      ownerIdHash: "worker-a",
    });
    expect(snapshot).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.Completed,
      process: {
        state: ReviewCompletionProcessState.Completed,
        snapshotCommitReceiptId: "snapshot-receipt-1",
        nextActionAt: null,
      },
    });
  });

  it("maps a lower-generation snapshot receipt to completed_superseded", async () => {
    const fixture = await createFixture("superseded");
    fixture.publications.seed(
      publication("superseded", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );
    await fixture.advance.execute({
      executionId: "superseded",
      ownerIdHash: "worker-a",
    });
    fixture.snapshots.seed({
      snapshotCommitReceiptId: "receipt-superseded",
      executionId: "superseded",
      finalizedArtifactId: "artifact-superseded",
      publicationAttemptId: "publication-superseded",
      outcome: ReviewCompletionSnapshotOutcome.SupersededByHigherGeneration,
    });

    expect(
      await fixture.advance.execute({
        executionId: "superseded",
        ownerIdHash: "worker-a",
      }),
    ).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.CompletedSuperseded,
      process: { state: ReviewCompletionProcessState.CompletedSuperseded },
    });
  });

  it("terminalizes superseded-no-effect publication without successful settlement", async () => {
    const fixture = await createFixture("superseded-no-effect");
    fixture.publications.seed(
      publication("superseded-no-effect", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.SupersededNoEffect,
      }),
    );

    const result = await fixture.advance.execute({
      executionId: "superseded-no-effect",
      ownerIdHash: "worker-a",
    });
    expect(result).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.PublicationNotApplied,
      process: {
        state: ReviewCompletionProcessState.PublicationNotApplied,
        publicationAttemptId: "publication-superseded-no-effect",
        snapshotCommitReceiptId: null,
        nextActionAt: null,
        lastSafeReason:
          ReviewCompletionSafeReason.PublicationSupersededNoEffect,
      },
    });
    expect(fixture.snapshots.commitCalls).toBe(0);

    fixture.clock.advance(1_000);
    expect(
      await fixture.advance.execute({
        executionId: "superseded-no-effect",
        ownerIdHash: "worker-b",
      }),
    ).toEqual(result);
    expect(fixture.snapshots.commitCalls).toBe(0);
  });

  it("blocks terminal_unknown and never attempts snapshot mutation", async () => {
    const fixture = await createFixture("unknown");
    fixture.publications.seed(
      publication("unknown", {
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.TerminalUnknown,
      }),
    );

    expect(
      await fixture.advance.execute({
        executionId: "unknown",
        ownerIdHash: "worker-a",
      }),
    ).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.BlockedPublicationUnknown,
      process: {
        state: ReviewCompletionProcessState.BlockedPublicationUnknown,
      },
    });
    expect(fixture.snapshots.commitCalls).toBe(0);
  });

  it("restores publication and snapshot IDs after lost acknowledgements", async () => {
    const fixture = await createFixture("lost-ack");
    fixture.publications.failAfterRequestOnce = true;
    const first = await fixture.advance.execute({
      executionId: "lost-ack",
      ownerIdHash: "worker-a",
    });
    expect(first.status).toBe(AdvanceReviewCompletionProcessStatus.RetryDue);

    fixture.clock.advance(1_000);
    const restoredPublication = await fixture.advance.execute({
      executionId: "lost-ack",
      ownerIdHash: "worker-b",
    });
    expect(restoredPublication).toMatchObject({
      process: { publicationAttemptId: "publication-1" },
    });
    expect(fixture.publications.requestCalls).toBe(1);

    fixture.publications.seed(
      publication("lost-ack", {
        publicationAttemptId: "publication-1",
        state: ReviewCompletionPublicationState.Terminal,
        effectiveOutcome: ReviewCompletionPublicationOutcome.Succeeded,
      }),
    );
    await fixture.advance.execute({
      executionId: "lost-ack",
      ownerIdHash: "worker-b",
    });
    fixture.snapshots.failAfterCommitOnce = true;
    expect(
      await fixture.advance.execute({
        executionId: "lost-ack",
        ownerIdHash: "worker-b",
      }),
    ).toMatchObject({ status: AdvanceReviewCompletionProcessStatus.RetryDue });

    fixture.clock.advance(1_000);
    const restoredSnapshot = await fixture.advance.execute({
      executionId: "lost-ack",
      ownerIdHash: "worker-c",
    });
    expect(restoredSnapshot).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.Completed,
      process: { snapshotCommitReceiptId: "snapshot-receipt-1" },
    });
    expect(fixture.snapshots.commitCalls).toBe(1);
  });

  it("lets only one concurrent due scanner advance a process", async () => {
    const fixture = await createFixture("race");
    const scannerA = new ScanDueReviewCompletionProcesses(
      fixture.repository,
      fixture.advance,
      fixture.clock,
      fixture.ids,
      10_000,
    );
    const scannerB = new ScanDueReviewCompletionProcesses(
      fixture.repository,
      fixture.advance,
      fixture.clock,
      fixture.ids,
      10_000,
    );

    const [left, right] = await Promise.all([
      scannerA.execute({ ownerIdHash: "worker-a", limit: 10 }),
      scannerB.execute({ ownerIdHash: "worker-b", limit: 10 }),
    ]);
    expect(left.results.length + right.results.length).toBe(1);
    expect([...left.failures, ...right.failures]).toEqual([]);
    expect(fixture.publications.requestCalls).toBe(1);
  });

  it("owns slow siblings after an early rejection and returns actual partial success", async () => {
    const fixture = await createFixture("slow");
    await fixture.repository.createOrWake(createInput("failing"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(fixture.advance, "executeClaim").mockImplementation(
      async (claim) => {
        if (claim.executionId === "failing")
          throw new Error("secret-token-private-payload");
        started();
        await held;
        return {
          status: AdvanceReviewCompletionProcessStatus.Advanced,
          process: null,
        };
      },
    );
    const scanner = new ScanDueReviewCompletionProcesses(
      fixture.repository,
      fixture.advance,
      fixture.clock,
      fixture.ids,
      10_000,
    );
    let returned = false;
    const pending = scanner
      .execute({ ownerIdHash: "worker-a", limit: 10 })
      .then((value) => {
        returned = true;
        return value;
      });
    await active;
    await Promise.resolve();
    expect(returned).toBe(false);
    release();
    const result = await pending;
    expect(result).toEqual({
      results: [
        {
          status: AdvanceReviewCompletionProcessStatus.Advanced,
          process: null,
        },
      ],
      failures: [
        { executionId: "failing", code: "review_completion_advance_failed" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("does not acquire completion claims after stop", async () => {
    const fixture = await createFixture("unstarted");
    const claim = vi.spyOn(fixture.repository, "claimDue");
    const scanner = new ScanDueReviewCompletionProcesses(
      fixture.repository,
      fixture.advance,
      fixture.clock,
      fixture.ids,
      10_000,
    );
    const stop = new AbortController();
    stop.abort();
    expect(
      await scanner.execute({
        ownerIdHash: "worker-a",
        limit: 10,
        signal: stop.signal,
      }),
    ).toEqual({ results: [], failures: [] });
    expect(claim).not.toHaveBeenCalled();
  });

  it("drains a completion claim returned by a query that raced shutdown", async () => {
    const fixture = await createFixture("owned-before-stop");
    const stop = new AbortController();
    const originalClaim = fixture.repository.claimDue.bind(fixture.repository);
    vi.spyOn(fixture.repository, "claimDue").mockImplementationOnce(
      async (input) => {
        const claims = await originalClaim(input);
        stop.abort();
        return claims;
      },
    );
    const scanner = new ScanDueReviewCompletionProcesses(
      fixture.repository,
      fixture.advance,
      fixture.clock,
      fixture.ids,
      10_000,
    );
    const result = await scanner.execute({
      ownerIdHash: "worker-a",
      limit: 10,
      signal: stop.signal,
    });
    expect(result.results).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(fixture.publications.requestCalls).toBe(1);
    expect(
      await scanner.execute({
        ownerIdHash: "worker-a",
        limit: 10,
        signal: stop.signal,
      }),
    ).toEqual({ results: [], failures: [] });
  });

  it("rejects a stale worker transition after claim takeover", async () => {
    const fixture = await createFixture("takeover");
    const oldClaim = await fixture.repository.claimByExecutionId({
      executionId: "takeover",
      claimId: "old-claim",
      ownerIdHash: "worker-old",
      now: fixture.clock.now(),
      claimUntil: new Date(fixture.clock.now().getTime() + 100),
    });
    expect(oldClaim).not.toBeNull();
    fixture.clock.advance(101);
    const newClaim = await fixture.repository.claimByExecutionId({
      executionId: "takeover",
      claimId: "new-claim",
      ownerIdHash: "worker-new",
      now: fixture.clock.now(),
      claimUntil: new Date(fixture.clock.now().getTime() + 100),
    });
    expect(newClaim).not.toBeNull();

    expect(await fixture.advance.executeClaim(oldClaim!)).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.StaleClaim,
    });
    expect(await fixture.advance.executeClaim(newClaim!)).toMatchObject({
      status: AdvanceReviewCompletionProcessStatus.RetryDue,
    });
    expect(fixture.publications.requestCalls).toBe(1);
  });

  it("recovers a missing row and finds a late commit behind the cursor next pass", async () => {
    const repository = new InMemoryReviewCompletionProcessRepository();
    const feed = new InMemoryReviewCompletionRecoveryFeed(repository);
    feed.seed(recoveryCandidate("a", 1_000));
    feed.seed(recoveryCandidate("c", 3_000));
    const recovery = new RecoverMissingReviewCompletionProcesses(
      feed,
      repository,
      1,
    );

    expect(await recovery.scanNextPage()).toMatchObject({
      visited: 1,
      completedPass: false,
    });
    feed.seed(recoveryCandidate("late", 500));
    expect(await recovery.scanNextPage()).toMatchObject({
      visited: 1,
      completedPass: false,
    });
    expect(await recovery.scanNextPage()).toMatchObject({
      visited: 0,
      completedPass: true,
      nextCursor: null,
    });
    expect(await recovery.scanNextPage()).toMatchObject({
      visited: 1,
      completedPass: false,
    });
    expect(await repository.findByExecutionId("late")).toMatchObject({
      executionId: "late",
      lastWakeupKind: ReviewCompletionWakeupKind.RecoveryScan,
    });
  });

  it("keeps recovery and due schedulers disabled by default", async () => {
    const fixture = await createFixture("composition");
    const composition = composeReviewCompletionProcesses({
      processes: fixture.repository,
      executions: fixture.executions,
      publications: fixture.publications,
      snapshots: fixture.snapshots,
      clock: fixture.clock,
      ids: fixture.ids,
      claimDurationMs: 10_000,
      retryDelayMs: () => 1_000,
    });
    expect(composition.schedulers).toEqual({
      mode: ReviewCompletionSchedulerMode.Disabled,
      due: null,
      recovery: null,
    });
  });
});

async function createFixture(
  executionId: string,
  coverage = ReviewExecutionCompletionCoverage.Completed,
) {
  const repository = new InMemoryReviewCompletionProcessRepository();
  const executions = new InMemoryReviewCompletionExecutionQuery();
  const publications = new InMemoryReviewCompletionPublicationPort();
  const snapshots = new InMemoryReviewCompletionSnapshotPort();
  const clock = new MutableReviewCompletionClock(start);
  const ids = new SequentialReviewCompletionIds();
  executions.seed({
    executionId,
    finalizedArtifactId: `artifact-${executionId}`,
    coverage,
  });
  await repository.createOrWake(createInput(executionId));
  const advance = new AdvanceReviewCompletionProcess(
    repository,
    executions,
    publications,
    snapshots,
    clock,
    ids,
    { claimDurationMs: 10_000, retryDelayMs: () => 1_000 },
  );
  return {
    repository,
    executions,
    publications,
    snapshots,
    clock,
    ids,
    advance,
  };
}

function createInput(executionId: string) {
  return {
    executionId,
    finalizedArtifactId: `artifact-${executionId}`,
    wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
    wakeupAt: start,
    retainUntil,
  };
}

function publication(
  executionId: string,
  overrides: Partial<ReviewCompletionPublicationFacts> = {},
): ReviewCompletionPublicationFacts {
  return {
    publicationAttemptId: `publication-${executionId}`,
    executionId,
    finalizedArtifactId: `artifact-${executionId}`,
    state: ReviewCompletionPublicationState.Pending,
    effectiveOutcome: null,
    nextCheckAt: new Date(start.getTime() + 1_000),
    ...overrides,
  };
}

function recoveryCandidate(executionId: string, offset: number) {
  return {
    executionId,
    finalizedArtifactId: `artifact-${executionId}`,
    createdAt: new Date(start.getTime() + offset),
    retainUntil,
  };
}
