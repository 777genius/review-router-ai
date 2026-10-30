import { describe, expect, it, vi } from "vitest";
import {
  OutboxHandlerError,
  type OutboxEvent,
} from "@reviewrouter/features-outbox";
import {
  AdvanceReviewCompletionProcessStatus,
  ReviewCompletionWakeupKind,
  ReviewExecutionCompletionCoverage,
} from "@reviewrouter/features-review-processes";
import {
  ReviewCompletionSchedulerMode,
  composeReviewCompletionProcesses,
} from "@reviewrouter/features-review-processes/composition";
import {
  InMemoryReviewCompletionExecutionQuery,
  InMemoryReviewCompletionProcessRepository,
  InMemoryReviewCompletionPublicationPort,
  InMemoryReviewCompletionRecoveryFeed,
  InMemoryReviewCompletionSnapshotPort,
  MutableReviewCompletionClock,
  SequentialReviewCompletionIds,
} from "@reviewrouter/features-review-processes/testing";
import {
  createReviewExecutionFinalizedHandler,
  createReviewV2WorkerFeature,
  createReviewV2WorkerOwnerId,
  reviewExecutionFinalizedEventType,
  reviewExecutionFinalizedEventVersion,
  reviewV2WorkerEnabledEnv,
  runReviewV2Maintenance,
  type ReviewV2CompletionRuntime,
} from "./review-v2-worker-runtime";

const now = new Date("2026-07-22T12:00:00.000Z");
const retainUntil = new Date("2026-08-22T12:00:00.000Z");
const ownerIdHash = createReviewV2WorkerOwnerId("worker-test");

describe("review v2 worker runtime", () => {
  it("is inert by default and fails closed when enabled without composition", async () => {
    let composed = false;
    const disabled = createReviewV2WorkerFeature({
      env: {},
      createEnabledRuntime: () => {
        composed = true;
        throw new Error("must_not_compose");
      },
    });
    expect(disabled.enabled).toBe(false);
    expect(disabled.handlers).toEqual([]);
    await expect(disabled.runMaintenance()).resolves.toEqual({
      intentsScanned: 0,
      intentsDispatched: 0,
      intentsRecovered: 0,
      intentDispatchFailures: 0,
      recovered: 0,
      advanced: 0,
      publicationProcessed: 0,
      publicationManualRequired: 0,
      publicationTerminalUnknown: 0,
      progressPromoted: 0,
      progressClaimed: 0,
      progressPublished: 0,
      progressDeferred: 0,
      progressSuppressed: 0,
      progressFailed: 0,
      expiredExecutionsScanned: 0,
      expiredExecutionsRecovered: 0,
      expiredExecutionConflicts: 0,
      expiredExecutionFailures: 0,
      failures: [],
      blockedPhases: [],
    });
    expect(composed).toBe(false);

    expect(() =>
      createReviewV2WorkerFeature({
        env: { [reviewV2WorkerEnabledEnv]: "1" },
      }),
    ).toThrow("review_v2_worker_enabled_composition_missing");

    expect(() =>
      createReviewV2WorkerFeature({
        env: {
          [reviewV2WorkerEnabledEnv]: "1",
          REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
        },
        createEnabledRuntime: () => {
          throw new Error("must_not_compose");
        },
      }),
    ).toThrow("review_v2_ingress_requires_fenced_outbox_takeover");
  });

  it("converges duplicate finalized events without duplicate publication requests", async () => {
    const fixture = await createFixture();
    const handler = createReviewExecutionFinalizedHandler({
      runtime: fixture.runtime,
      ownerIdHash,
      wakeups: {
        findFinalizedWakeup: async () => ({
          executionId: "execution-1",
          finalizedArtifactId: "artifact-1",
          finalizedAt: now,
          retainUntil,
        }),
      },
    });

    await handler.handle(finalizedEvent());
    await handler.handle(finalizedEvent());

    expect(fixture.publications.requestCalls).toBe(1);
    await expect(
      fixture.repository.findByExecutionId("execution-1"),
    ).resolves.toMatchObject({
      publicationAttemptId: "publication-1",
    });
  });

  it("runs recovery before due scan so a missing process advances in the same pass", async () => {
    const fixture = await createFixture({ createProcess: false });
    fixture.recoveryFeed.seed({
      executionId: "execution-1",
      finalizedArtifactId: "artifact-1",
      createdAt: now,
      retainUntil,
    });

    await expect(
      runReviewV2Maintenance({
        runtime: fixture.runtime,
        ownerIdHash,
        dueLimit: 10,
        publication: {
          async runMaintenance() {
            return {
              processed: 3,
              manualRequired: 1,
              terminalUnknown: 1,
              settledExecutionIds: ["execution-1", "execution-1"],
              progressSettlements: [],
            };
          },
        },
      }),
    ).resolves.toEqual({
      intentsScanned: 0,
      intentsDispatched: 0,
      intentsRecovered: 0,
      intentDispatchFailures: 0,
      recovered: 1,
      advanced: 2,
      publicationProcessed: 3,
      publicationManualRequired: 1,
      publicationTerminalUnknown: 1,
      progressPromoted: 0,
      progressClaimed: 0,
      progressPublished: 0,
      progressDeferred: 0,
      progressSuppressed: 0,
      progressFailed: 0,
      expiredExecutionsScanned: 0,
      expiredExecutionsRecovered: 0,
      expiredExecutionConflicts: 0,
      expiredExecutionFailures: 0,
      failures: [],
      blockedPhases: [],
    });
    expect(fixture.publications.requestCalls).toBe(1);
  });

  it("settles the final publication before terminal progress and its comment", async () => {
    const fixture = await createFixture();
    const order: string[] = [];

    await runReviewV2Maintenance({
      runtime: fixture.runtime,
      ownerIdHash,
      dueLimit: 10,
      publication: {
        async runMaintenance() {
          order.push("final-publication");
          return {
            processed: 1,
            manualRequired: 0,
            terminalUnknown: 0,
            settledExecutionIds: ["execution-1"],
            progressSettlements: [
              { executionId: "execution-1", outcome: "failed" },
            ],
          };
        },
      },
      progress: {
        async promoteSettledExecutions({ settlements }) {
          order.push(
            `terminal:${settlements.map(({ executionId, outcome }) => `${executionId}:${outcome}`).join(",")}`,
          );
          return 1;
        },
        async runMaintenance() {
          order.push("progress-publication");
          return {
            claimed: 1,
            published: 1,
            deferred: 0,
            suppressed: 0,
            failed: 0,
          };
        },
      },
    });

    expect(order).toEqual([
      "final-publication",
      "terminal:execution-1:failed",
      "progress-publication",
    ]);
  });

  it("isolates progress promotion and publication failures", async () => {
    const fixture = await createFixture();
    await expect(
      runReviewV2Maintenance({
        runtime: fixture.runtime,
        ownerIdHash,
        dueLimit: 10,
        publication: {
          async runMaintenance() {
            return {
              processed: 1,
              manualRequired: 0,
              terminalUnknown: 0,
              settledExecutionIds: ["execution-1"],
              progressSettlements: [
                { executionId: "execution-1", outcome: "succeeded" },
              ],
            };
          },
        },
        progress: {
          async promoteSettledExecutions() {
            throw new Error("projection_corrupt");
          },
          async runMaintenance() {
            throw new Error("github_unavailable");
          },
        },
      }),
    ).resolves.toMatchObject({
      publicationProcessed: 1,
      progressPromoted: null,
      progressFailed: null,
      failures: [
        {
          phase: "review_v2.progress_promotion",
          safeErrorSummary: "projection_corrupt",
        },
        {
          phase: "review_v2.progress_publication",
          safeErrorSummary: "github_unavailable",
        },
      ],
    });
  });

  it.each([
    ["recovery", "recovered"],
    ["execution_recovery", "expiredExecutionsScanned"],
    ["intents", "intentsScanned"],
    ["due", "advanced"],
    ["publication", "publicationProcessed"],
  ] as const)(
    "isolates %s failure and keeps its metrics unavailable",
    async (failed, metric) => {
      const fixture = await createFixture();
      const order: string[] = [];
      const attempt = (phase: string) => {
        order.push(phase);
        if (phase === failed)
          throw new Error("dependency github_pat_private123 unavailable");
      };
      const recovery = fixture.runtime.schedulers.recovery.scanNextPage.bind(
        fixture.runtime.schedulers.recovery,
      );
      vi.spyOn(
        fixture.runtime.schedulers.recovery,
        "scanNextPage",
      ).mockImplementation(async () => {
        attempt("recovery");
        return recovery();
      });
      const due = fixture.runtime.schedulers.due.execute.bind(
        fixture.runtime.schedulers.due,
      );
      vi.spyOn(fixture.runtime.schedulers.due, "execute").mockImplementation(
        async (input) => {
          attempt("due");
          return due(input);
        },
      );
      const result = await runReviewV2Maintenance({
        runtime: fixture.runtime,
        ownerIdHash,
        dueLimit: 10,
        executionRecovery: {
          execute: async () => {
            attempt("execution_recovery");
            return { scanned: 2, recovered: 1, conflicts: 0, failures: 0 };
          },
        },
        intents: {
          runMaintenance: async () => {
            attempt("intents");
            return { scanned: 2, dispatched: 1, recovered: 0, failed: 0 };
          },
        },
        publication: {
          runMaintenance: async () => {
            attempt("publication");
            return {
              processed: 1,
              manualRequired: 0,
              terminalUnknown: 0,
              settledExecutionIds: [],
              progressSettlements: [],
            };
          },
        },
        progress: {
          promoteSettledExecutions: async () => {
            attempt("promotion");
            return 0;
          },
          runMaintenance: async () => {
            attempt("progress");
            return {
              claimed: 1,
              published: 1,
              deferred: 0,
              suppressed: 0,
              failed: 0,
            };
          },
        },
      });
      expect(result[metric]).toBeNull();
      expect(result.failures).toEqual([
        {
          phase: `review_v2.${failed}`,
          safeErrorSummary: "dependency <redacted> unavailable",
        },
      ]);
      expect(order).toEqual([
        "recovery",
        "execution_recovery",
        "intents",
        "due",
        "publication",
        ...(failed === "publication" ? [] : ["promotion", "progress"]),
      ]);
      if (failed === "publication") {
        expect(result.progressPromoted).toBeNull();
        expect(result.progressPublished).toBeNull();
        expect(result.advanced).toBeNull();
        expect(result.blockedPhases).toEqual([
          {
            phase: "review_v2.progress_promotion",
            blockedBy: "review_v2.publication",
          },
          {
            phase: "review_v2.progress_publication",
            blockedBy: "review_v2.publication",
          },
        ]);
      } else {
        expect(result.publicationProcessed).toBe(1);
        expect(result.progressPublished).toBe(1);
        expect(result.blockedPhases).toEqual([]);
      }
    },
  );

  it("isolates failed publication wakeups without losing committed settlement evidence", async () => {
    const fixture = await createFixture();
    const wakeups: string[] = [];
    const order: string[] = [];
    vi.spyOn(fixture.runtime.advance, "execute").mockImplementation(
      async ({ executionId }) => {
        wakeups.push(executionId);
        if (executionId === "bad")
          throw Object.assign(new Error("failed github_pat_private123"), {
            cause: "tenant-payload",
          });
        return { status: AdvanceReviewCompletionProcessStatus.Advanced };
      },
    );
    vi.spyOn(fixture.runtime.schedulers.due, "execute").mockResolvedValue([]);
    const promote = vi.fn(async () => {
      order.push("promotion");
      return 2;
    });
    const settlements = [
      { executionId: "bad", outcome: "failed" as const },
      { executionId: "good", outcome: "succeeded" as const },
    ];
    const result = await runReviewV2Maintenance({
      runtime: fixture.runtime,
      ownerIdHash,
      dueLimit: 10,
      publication: {
        runMaintenance: async () => {
          order.push("publication");
          return {
            processed: 2,
            manualRequired: 0,
            terminalUnknown: 0,
            settledExecutionIds: ["bad", "good", "bad"],
            progressSettlements: settlements,
          };
        },
      },
      progress: {
        promoteSettledExecutions: promote,
        runMaintenance: async () => {
          order.push("progress");
          return {
            claimed: 2,
            published: 2,
            deferred: 0,
            suppressed: 0,
            failed: 0,
          };
        },
      },
    });
    expect(wakeups).toEqual(["bad", "good"]);
    expect(promote).toHaveBeenCalledExactlyOnceWith({ settlements });
    expect(order).toEqual(["publication", "promotion", "progress"]);
    expect(result).toMatchObject({
      advanced: null,
      publicationProcessed: 2,
      progressPromoted: 2,
      progressPublished: 2,
      failures: [
        {
          phase: "review_v2.publication_wakeup",
          safeErrorSummary: "failed <redacted>",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("tenant-payload");
  });

  it("keeps already eligible progress publishing when optional publication is absent", async () => {
    const fixture = await createFixture();
    const promotion = vi.fn(async () => 0);
    const publish = vi.fn(async () => ({
      claimed: 1,
      published: 1,
      deferred: 0,
      suppressed: 0,
      failed: 0,
    }));
    const result = await runReviewV2Maintenance({
      runtime: fixture.runtime,
      ownerIdHash,
      dueLimit: 10,
      progress: {
        promoteSettledExecutions: promotion,
        runMaintenance: publish,
      },
    });
    expect(promotion).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      publicationProcessed: 0,
      progressPromoted: 0,
      progressPublished: 1,
      failures: [],
      blockedPhases: [],
    });
  });

  it("still publishes already eligible progress after promotion alone fails", async () => {
    const fixture = await createFixture();
    const publish = vi.fn(async () => ({
      claimed: 1,
      published: 1,
      deferred: 0,
      suppressed: 0,
      failed: 0,
    }));
    const result = await runReviewV2Maintenance({
      runtime: fixture.runtime,
      ownerIdHash,
      dueLimit: 10,
      publication: {
        runMaintenance: async () => ({
          processed: 1,
          manualRequired: 0,
          terminalUnknown: 0,
          settledExecutionIds: [],
          progressSettlements: [],
        }),
      },
      progress: {
        promoteSettledExecutions: async () => {
          throw new Error("promotion_unavailable");
        },
        runMaintenance: publish,
      },
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      progressPromoted: null,
      progressPublished: 1,
      failures: [
        {
          phase: "review_v2.progress_promotion",
          safeErrorSummary: "promotion_unavailable",
        },
      ],
    });
  });

  it("quarantines malformed finalized events and retries temporarily missing facts", async () => {
    const fixture = await createFixture();
    const missing = createReviewExecutionFinalizedHandler({
      runtime: fixture.runtime,
      ownerIdHash,
      wakeups: { findFinalizedWakeup: async () => null },
    });
    await expect(missing.handle(finalizedEvent())).rejects.toMatchObject({
      name: "OutboxHandlerError",
      code: "review_v2_finalized_facts_unavailable",
      retryable: true,
    } satisfies Partial<OutboxHandlerError>);

    await expect(
      missing.handle(
        finalizedEvent({ payload: { executionId: "execution-1" } }),
      ),
    ).rejects.toMatchObject({
      code: "review_v2_finalized_event_invalid",
      retryable: false,
    } satisfies Partial<OutboxHandlerError>);
  });
});

async function createFixture(input: { readonly createProcess?: boolean } = {}) {
  const repository = new InMemoryReviewCompletionProcessRepository();
  const executions = new InMemoryReviewCompletionExecutionQuery();
  const publications = new InMemoryReviewCompletionPublicationPort();
  const snapshots = new InMemoryReviewCompletionSnapshotPort();
  const clock = new MutableReviewCompletionClock(now);
  const ids = new SequentialReviewCompletionIds();
  const recoveryFeed = new InMemoryReviewCompletionRecoveryFeed(repository);
  executions.seed({
    executionId: "execution-1",
    finalizedArtifactId: "artifact-1",
    coverage: ReviewExecutionCompletionCoverage.Completed,
  });
  const runtime = composeReviewCompletionProcesses({
    processes: repository,
    executions,
    publications,
    snapshots,
    clock,
    ids,
    claimDurationMs: 10_000,
    retryDelayMs: () => 1_000,
    schedulerMode: ReviewCompletionSchedulerMode.Enabled,
    recoveryFeed,
    recoveryPageSize: 10,
  });
  const schedulers = runtime.schedulers;
  if (schedulers.mode !== ReviewCompletionSchedulerMode.Enabled) {
    throw new Error("test_scheduler_not_enabled");
  }
  const typedRuntime: ReviewV2CompletionRuntime = {
    wake: runtime.wake,
    advance: {
      execute: async (command: {
        readonly executionId: string;
        readonly ownerIdHash: string;
      }) => runtime.advance.execute(command),
    },
    schedulers: {
      mode: ReviewCompletionSchedulerMode.Enabled,
      due: schedulers.due,
      recovery: schedulers.recovery,
    },
  };
  if (input.createProcess !== false) {
    await runtime.wake.execute({
      executionId: "execution-1",
      finalizedArtifactId: "artifact-1",
      wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
      wakeupAt: now,
      retainUntil,
    });
  }
  return {
    repository,
    publications,
    recoveryFeed,
    runtime: typedRuntime,
  };
}

function finalizedEvent(override: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: "outbox-1",
    type: reviewExecutionFinalizedEventType,
    version: reviewExecutionFinalizedEventVersion,
    idempotencyKey: "review-execution-finalized:v2:execution-1",
    workspaceId: "workspace-1",
    repositoryId: "repository-1",
    aggregateId: "execution-1",
    payload: {
      executionId: "execution-1",
      artifactId: "artifact-1",
      artifactHash: "a".repeat(64),
      generation: "1",
      reviewRevisionHash: "b".repeat(64),
      projectionHash: "c".repeat(64),
    },
    status: "processing",
    attempts: 1,
    maxAttempts: 5,
    nextAttemptAt: null,
    claimId: "claim-1",
    claimVersion: 1n,
    claimOwnerHash: ownerIdHash,
    claimUntil: new Date("2026-07-22T12:01:00.000Z"),
    occurredAt: now,
    ...override,
  };
}
