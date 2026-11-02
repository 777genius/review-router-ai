import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createHistoryDatabase } from "./history-postgres-fixture";
import {
  createHistorySourceFixture,
  finalizeHistoryExecution,
  hash,
  limits,
  revision,
} from "./history-source-fixture";
import { activateHistoryCapture } from "../adapters/outbound/prisma-history-writer";
import { createPrismaHistoryProjector } from "../adapters/outbound/prisma-history-projector";
import { createPrismaHistoryReader } from "../adapters/outbound/prisma-history-reader";
import {
  parseHistoryChangedEvent,
  HistoryCollisionError,
  historyChangedEventType,
  type HistoryChangedEvent,
} from "../domain/history-events";
import { PrismaReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/composition";
import { PrismaReviewExecutionStore } from "@reviewrouter/features-review-executions/composition";
import { PrismaReviewCompletionProcessRepository } from "@reviewrouter/features-review-processes/composition";
import {
  ReviewCompletionProcessState,
  ReviewCompletionSafeReason,
  ReviewCompletionWakeupKind,
} from "@reviewrouter/features-review-processes";
const adminUrl = process.env.HISTORY_TEST_POSTGRES_ADMIN_URL;
if (process.env.HISTORY_REQUIRE_POSTGRES === "1" && !adminUrl)
  throw new Error(
    "HISTORY_TEST_POSTGRES_ADMIN_URL is required for history qualification",
  );
describe.skipIf(!adminUrl)(
  "review history actual source transactions and PostgreSQL",
  () => {
    let prisma: PrismaClient, cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ prisma, cleanup } = await createHistoryDatabase(adminUrl!));
    }, 120000);
    afterAll(async () => {
      await cleanup?.();
    });
    async function events(root: string) {
      return (
        await prisma.outboxEvent.findMany({
          where: { type: historyChangedEventType, aggregateId: root },
          orderBy: { createdAt: "asc" },
        })
      ).map((row) => parseHistoryChangedEvent(row.payload));
    }
    async function drain(root: string) {
      const projector = createPrismaHistoryProjector(prisma);
      for (const event of await events(root)) await projector.project(event);
    }
    it("activates once, excludes old roots and rolls back source + sequence + event on capture failure", async () => {
      await prisma.reviewHistoryCoverage.deleteMany();
      const f = await createHistorySourceFixture(prisma),
        old = f.candidate();
      await f.intents.registerIntent({ candidate: old });
      expect(
        await prisma.reviewHistoryRun.findUnique({
          where: { rootRequestId: old.requestId },
        }),
      ).toBeNull();
      const time = await activateHistoryCapture(prisma);
      expect(await activateHistoryCapture(prisma)).toEqual(time);
      const failing = new PrismaReviewRequestedIntentStore(prisma, {
        historyCapture: {
          register: async (tx, i, m) => {
            await f.writer.register(tx, i, m);
            throw new Error("capture_failure");
          },
          changed: (tx, i, p) => f.writer.captureIntent(tx, i, p),
        },
      });
      const c = f.candidate();
      await expect(failing.registerIntent({ candidate: c })).rejects.toThrow(
        "capture_failure",
      );
      expect(await f.intents.findByRequestId(c.requestId)).toBeNull();
      expect(await events(c.requestId)).toEqual([]);
      expect(
        await prisma.reviewHistoryRun.findUnique({
          where: { rootRequestId: c.requestId },
        }),
      ).toBeNull();
      // The old root remains excluded after a later genuine source mutation.
      await f.intents.cancelPreAdmission({ ...f.scope, now: new Date() });
      expect(await events(old.requestId)).toEqual([]);
    });
    it("allocates once for duplicate delivery and preserves new-root latest under old replay", async () => {
      await activateHistoryCapture(prisma);
      const f = await createHistorySourceFixture(prisma),
        first = f.candidate();
      await Promise.all([
        f.intents.registerIntent({ candidate: first }),
        f.intents.registerIntent({ candidate: first }),
      ]);
      const before = await prisma.reviewHistoryRun.findUniqueOrThrow({
        where: { rootRequestId: first.requestId },
      });
      expect(before.runSequence).toBe(1n);
      expect(before.projectedAt).toBeNull();
      const second = f.candidate();
      await f.intents.registerIntent({ candidate: second });
      const latest = await prisma.reviewHistoryRun.findUniqueOrThrow({
        where: { rootRequestId: second.requestId },
      });
      expect(latest.runSequence).toBe(2n);
      await drain(second.requestId);
      await drain(first.requestId);
      const pr = await prisma.reviewHistoryPullRequest.findUniqueOrThrow({
        where: { id: before.pullRequestId },
      });
      expect(pr.latestRootRequestId).toBe(second.requestId);
      const reader = createPrismaHistoryReader(prisma);
      const report = await reader.listPullRequests({
        actorId: f.actorId,
        workspaceId: f.scope.workspaceId,
        filters: { q: "", repositoryId: null, status: "all", days: null },
      });
      expect(report.items).toHaveLength(1);
      expect(report.items[0]?.pullRequestTitle).toBe("A captured title");
      const e = (await events(second.requestId))[0]!;
      await expect(
        createPrismaHistoryProjector(prisma).project({
          ...e,
          snapshot: {
            ...e.snapshot,
            facts: {
              ...(e.snapshot.facts as object),
              state:
                e.snapshot.facts.state === "superseded"
                  ? "pending_dispatch"
                  : "superseded",
            },
          },
        } as HistoryChangedEvent),
      ).rejects.toThrow(HistoryCollisionError);
    });
    it("pins candidate one over a later higher-generation loser and captures after intent pruning", async () => {
      const f = await createHistorySourceFixture(prisma),
        c = f.candidate();
      await f.dispatch(c);
      await f.prepare(`winner-${c.requestId}`, "1", c.requestId);
      await f.admit(`winner-${c.requestId}`);
      expect((await f.link(c, `winner-${c.requestId}`)).status).toBe("applied");
      await f.prepare(`loser-${c.requestId}`, "2", c.requestId);
      await f.admit(`loser-${c.requestId}`);
      expect((await f.link(c, `loser-${c.requestId}`)).status).toBe("conflict");
      const loser = await f.executions.findExecution(`loser-${c.requestId}`);
      await f.executions.supersedeExecution({
        scope: f.scope,
        executionId: loser!.execution.executionId,
        expectedStreamVersion: loser!.stream.version,
        observedCurrentRevision: {
          ...revision,
          headSha: "d".repeat(40),
          reviewRevisionHash: hash("e"),
        },
        now: new Date(),
      });
      const ledger = await prisma.reviewHistoryRun.findUniqueOrThrow({
        where: { rootRequestId: c.requestId },
      });
      expect(ledger.boundExecutionId).toBe(`winner-${c.requestId}`);
      const captured = await events(c.requestId);
      expect(
        captured.some(
          (e) => e.executionSeed?.sourceId === `winner-${c.requestId}`,
        ),
      ).toBe(true);
      expect(
        captured.some((e) => e.snapshot.sourceId === `loser-${c.requestId}`),
      ).toBe(false);
      await prisma.reviewRequestedIntent.update({
        where: { requestId: c.requestId },
        data: { retainUntil: new Date(0) },
      });
      expect(await f.intents.pruneRetainedIntents({ limit: 10 })).toBe(1);
      const projector = createPrismaHistoryProjector(prisma);
      for (const e of captured.reverse()) await projector.project(e);
      expect(
        (
          await prisma.reviewHistoryRun.findUniqueOrThrow({
            where: { rootRequestId: c.requestId },
          })
        ).status,
      ).toBe("stopped");
    });
    it("rolls back execution mutation when its history hook fails", async () => {
      const f = await createHistorySourceFixture(prisma),
        c = f.candidate();
      await f.dispatch(c);
      const id = `execution-${c.requestId}`;
      await f.prepare(id, "3", c.requestId);
      await f.admit(id);
      await f.link(c, id);
      const current = await f.executions.findExecution(id);
      const failed = new PrismaReviewExecutionStore(prisma, {
        historyCapture: async () => {
          throw new Error("execution_capture_failed");
        },
      });
      await expect(
        failed.supersedeExecution({
          scope: f.scope,
          executionId: id,
          expectedStreamVersion: current!.stream.version,
          observedCurrentRevision: {
            ...revision,
            headSha: "d".repeat(40),
            reviewRevisionHash: hash("e"),
          },
          now: new Date(),
        }),
      ).rejects.toThrow("execution_capture_failed");
      expect((await f.executions.findExecution(id))?.execution.state).toBe(
        "running",
      );
    });
    it("captures all meaningful completion transitions, rolls back hook failure and replays without source rows", async () => {
      const f = await createHistorySourceFixture(prisma),
        c = f.candidate();
      await f.dispatch(c);
      const id = `execution-${c.requestId}`;
      await f.prepare(id, "4", c.requestId);
      await f.admit(id);
      await f.link(c, id);
      const running = await f.executions.findExecution(id),
        artifactId = `artifact-${id}`;
      await f.executions.finalizeExecution({
        scope: f.scope,
        executionId: id,
        expectedStreamVersion: running!.stream.version,
        expectedExecutionVersion: running!.execution.version,
        artifactId,
        artifactHash: hash("f"),
        projectionEnvelopeVersion: 1,
        projectionEnvelopeJson: '{"findings":[]}',
        projectionHash: hash("d"),
        byteCount: 15,
        findingCount: 0,
        lifecycleStateHash: hash("e"),
        commandLedgerWatermark: 0n,
        projectionPolicyVersion: "history",
        publicationSafetyDecisionHash: hash("6"),
        publicationNotAfter: new Date(Date.now() + 60000),
        permitEpoch: 1n,
        allowPartial: false,
        limits,
        now: new Date(),
        retainUntil: new Date(Date.now() + 86400000),
      });
      const hooks = {
        beforeMutation: (
          tx: Parameters<typeof f.writer.beforeCompletion>[0],
          executionId: string,
        ) => f.writer.beforeCompletion(tx, executionId),
        changed: (
          tx: Parameters<typeof f.writer.captureCompletion>[0],
          next: Parameters<typeof f.writer.captureCompletion>[1],
          prev?: Parameters<typeof f.writer.captureCompletion>[2],
        ) => f.writer.captureCompletion(tx, next, prev),
      };
      const processes = new PrismaReviewCompletionProcessRepository(
        prisma,
        async () => undefined,
        hooks,
      );
      await processes.createOrWake({
        executionId: id,
        finalizedArtifactId: artifactId,
        wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
        wakeupAt: new Date(),
        retainUntil: new Date(Date.now() + 86400000),
      });
      const claim = await processes.claimByExecutionId({
        executionId: id,
        claimId: randomUUID(),
        ownerIdHash: "history-owner",
        now: new Date(),
        claimUntil: new Date(Date.now() + 60000),
      });
      const broken = new PrismaReviewCompletionProcessRepository(
        prisma,
        async () => undefined,
        {
          ...hooks,
          changed: async () => {
            throw new Error("completion_capture_failed");
          },
        },
      );
      await expect(
        broken.applyTransition(claim!, {
          state: ReviewCompletionProcessState.BlockedPublicationUnknown,
          lastSafeReason: ReviewCompletionSafeReason.PublicationTerminalUnknown,
          nextActionAt: null,
          now: new Date(),
        }),
      ).rejects.toThrow("completion_capture_failed");
      expect((await processes.findByExecutionId(id))?.state).toBe(
        ReviewCompletionProcessState.AwaitingPublication,
      );
      await processes.applyTransition(claim!, {
        state: ReviewCompletionProcessState.BlockedPublicationUnknown,
        lastSafeReason: ReviewCompletionSafeReason.PublicationTerminalUnknown,
        nextActionAt: null,
        now: new Date(),
      });
      const captured = await events(c.requestId);
      expect(
        captured.some(
          (e) =>
            e.snapshot.kind === "completion" &&
            e.snapshot.facts.state === "blocked_publication_unknown",
        ),
      ).toBe(true);
      // Source retention must not be needed to interpret saved payloads.
      await prisma.reviewCompletionProcess.deleteMany({
        where: { executionId: id },
      });
      await prisma.reviewRequestedIntent.deleteMany({
        where: { requestId: c.requestId },
      });
      await prisma.reviewExecutionStreamV2.deleteMany({ where: f.scope });
      await prisma.finalizedReviewProjectionArtifactV2.deleteMany({
        where: { executionId: id },
      });
      await prisma.reviewExecutionWorkSlotV2.deleteMany({
        where: { executionId: id },
      });
      await prisma.reviewExecutionV2.deleteMany({ where: { executionId: id } });
      const projector = createPrismaHistoryProjector(prisma);
      for (const e of captured.reverse()) await projector.project(e);
      expect(
        (
          await prisma.reviewHistoryRun.findUniqueOrThrow({
            where: { rootRequestId: c.requestId },
          })
        ).status,
      ).toBe("unconfirmed");
    });
    it("inherits recovery root/sequence but gives same-SHA manual rerun its own root", async () => {
      const f = await createHistorySourceFixture(prisma),
        c = f.candidate();
      await f.intents.registerIntent({ candidate: c });
      const claimed = await f.intents.claimIntent({
        requestId: c.requestId,
        claimId: randomUUID(),
        ownerIdHash: "recovery-owner",
        now: new Date(),
        claimUntil: new Date(Date.now() + 60000),
      });
      if (!("intent" in claimed) || !claimed.intent?.claim)
        throw new Error("fixture_claim_missing");
      const claim = claimed.intent.claim;
      await f.intents.beginSubmission({
        requestId: c.requestId,
        claimId: claim.claimId,
        ownerIdHash: claim.ownerIdHash,
        fencingToken: claim.fencingToken,
        now: new Date(),
        nextResolutionAt: new Date(Date.now() + 1000),
        resolutionDeadlineAt: new Date(Date.now() + 60000),
      });
      const before = await f.intents.findByRequestId(c.requestId),
        successor = { ...f.candidate(), dispatchAttempt: 2 };
      const recovered = await f.intents.recoverDispatch({
        requestId: c.requestId,
        expectedVersion: before!.version,
        successorCandidate: successor,
        sourceRunId: null,
        sourceRunAttempt: null,
        terminalReason: null,
        now: new Date(),
      });
      expect(recovered.status).toBe("applied");
      expect(
        (await f.intents.findByRequestId(successor.requestId))
          ?.historyRootRequestId,
      ).toBe(c.requestId);
      expect(
        await prisma.reviewHistoryRun.count({
          where: { workspaceId: f.scope.workspaceId },
        }),
      ).toBe(1);
      const projector = createPrismaHistoryProjector(prisma);
      for (const event of (await events(c.requestId)).reverse())
        await projector.project(event);
      expect(
        (
          await prisma.reviewHistoryRun.findUniqueOrThrow({
            where: { rootRequestId: c.requestId },
          })
        ).selectedDispatchAttempt,
      ).toBe(2);
      const g = await createHistorySourceFixture(prisma),
        initial = g.candidate();
      await g.dispatch(initial);
      const now = new Date(),
        rerun = g.candidate();
      const created = await g.intents.ensureRerunIntent({
        candidate: {
          ...g.scope,
          predecessorRequestId: initial.requestId,
          requestId: rerun.requestId,
          revision,
          triggerKind: rerun.triggerKind,
          deliveryIdentityHash: rerun.deliveryIdentityHash,
          canonicalRequestHash: rerun.canonicalRequestHash,
          sourceRunId: g.sourceRunId,
          sourceRunAttempt: "2",
          changedLines: 10,
          maxChangedLines: 100,
          policySnapshotId: "history-policy",
          admissionDecisionHash: hash("9"),
          verdict:
            "admitted" as import("@reviewrouter/features-review-executions").ReviewRequestAdmissionState.Admitted,
          createdAt: now,
          nextResolutionAt: new Date(now.getTime() + 1000),
          resolutionDeadlineAt: new Date(now.getTime() + 60000),
          retainUntil: new Date(now.getTime() + 86400000),
        },
      });
      expect(created.status).toBe("created");
      const first = await prisma.reviewHistoryRun.findUniqueOrThrow({
          where: { rootRequestId: initial.requestId },
        }),
        second = await prisma.reviewHistoryRun.findUniqueOrThrow({
          where: { rootRequestId: rerun.requestId },
        });
      expect(second.rootRequestId).not.toBe(first.rootRequestId);
      expect(second.headSha).toBe(first.headSha);
      expect(second.runSequence).toBe(first.runSequence + 1n);
    });
    it("serializes binding against completion creation in both orders and registration against projection", async () => {
      for (const completionFirst of [true, false]) {
        const f = await createHistorySourceFixture(prisma),
          c = f.candidate(),
          id = `race-${randomUUID()}`;
        await f.dispatch(c);
        await f.prepare(id, completionFirst ? "5" : "6", c.requestId);
        await f.admit(id);
        const artifactId = await finalizeHistoryExecution(f, id),
          gateHeld = deferred(),
          contenderEntered = deferred(),
          release = deferred();
        const intents = new PrismaReviewRequestedIntentStore(prisma, {
          historyCapture: {
            register: (tx, i, m) => f.writer.register(tx, i, m),
            changed: async (tx, i, p) => {
              if (i.state === "dispatched") {
                if (completionFirst) contenderEntered.resolve();
                else {
                  await tx.$queryRaw`SELECT "executionId" FROM "ReviewExecutionV2" WHERE "executionId"=${id} FOR UPDATE`;
                  gateHeld.resolve();
                  await release.promise;
                }
              }
              await f.writer.captureIntent(tx, i, p);
            },
          },
        });
        const processes = new PrismaReviewCompletionProcessRepository(
          prisma,
          async () => undefined,
          {
            beforeMutation: async (tx, executionId) => {
              if (!completionFirst) contenderEntered.resolve();
              await f.writer.beforeCompletion(tx, executionId);
              if (completionFirst) {
                gateHeld.resolve();
                await release.promise;
              }
            },
            changed: (tx, next, previous) =>
              f.writer.captureCompletion(tx, next, previous),
          },
        );
        const bind = () =>
          intents.linkAdmission({
            requestId: c.requestId,
            sourceRunId: f.sourceRunId,
            sourceRunAttempt: "1",
            authorizationId: f.authorizationId,
            executionId: id,
            revision,
            now: new Date(),
          });
        const create = () =>
          processes.createOrWake({
            executionId: id,
            finalizedArtifactId: artifactId,
            wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
            wakeupAt: new Date(),
            retainUntil: new Date(Date.now() + 86400000),
          });
        const first = completionFirst ? create() : bind();
        try {
          await gateHeld.promise;
          const second = completionFirst ? bind() : create();
          // Observe the real execution-gate wait. An execution FK check can
          // precede changed(), so a post-update callback is not a general barrier.
          if (completionFirst) await blockedAdmissionGate(prisma);
          else await contenderEntered.promise;
          expect(
            (
              await prisma.reviewHistoryRun.findUniqueOrThrow({
                where: { rootRequestId: c.requestId },
              })
            ).boundExecutionId,
          ).toBeNull();
          release.resolve();
          await Promise.all([first, second]);
        } finally {
          release.resolve();
        }
        const captured = await events(c.requestId),
          seed = captured.find((e) => e.executionSeed !== undefined);
        expect(seed?.executionSeed?.sourceId).toBe(id);
        expect(
          captured.filter((e) => e.executionSeed !== undefined),
        ).toHaveLength(1);
        if (completionFirst)
          expect(seed?.completionSeed?.facts.state).toBe(
            "awaiting_publication",
          );
        else
          expect(captured.some((e) => e.snapshot.kind === "completion")).toBe(
            true,
          );
        const projector = createPrismaHistoryProjector(prisma);
        await Promise.all(captured.reverse().map((e) => projector.project(e)));
        const result = await prisma.reviewHistoryRun.findUniqueOrThrow({
          where: { rootRequestId: c.requestId },
        });
        expect(result.status).toBe("publishing");
        expect(result.completionCursor).not.toBeNull();
      }
      const f = await createHistorySourceFixture(prisma),
        initial = f.candidate();
      await f.intents.registerIntent({ candidate: initial });
      const held = deferred(),
        release = deferred(),
        next = f.candidate();
      const registering = new PrismaReviewRequestedIntentStore(prisma, {
        historyCapture: {
          register: async (tx, i, m) => {
            await f.writer.register(tx, i, m);
            held.resolve();
            await release.promise;
          },
          changed: (tx, i, p) => f.writer.captureIntent(tx, i, p),
        },
      }).registerIntent({ candidate: next });
      await held.promise;
      const projecting = createPrismaHistoryProjector(prisma).project(
        (await events(initial.requestId))[0]!,
      );
      release.resolve();
      await Promise.all([registering, projecting]);
      await drain(next.requestId);
      const runs = await prisma.reviewHistoryRun.findMany({
        where: { workspaceId: f.scope.workspaceId },
        orderBy: { runSequence: "asc" },
      });
      expect(runs.map((row) => row.runSequence)).toEqual([1n, 2n]);
      expect(
        (
          await prisma.reviewHistoryPullRequest.findUniqueOrThrow({
            where: { id: runs[0]!.pullRequestId },
          })
        ).latestRootRequestId,
      ).toBe(next.requestId);
    });
  },
);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function blockedAdmissionGate(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND (query ILIKE '%ReviewRequestedIntent%' OR query ILIKE '%ReviewExecutionV2%')
          AND query ILIKE '%UPDATE%'
      ) AS waiting`;
    if (row?.waiting) return;
    await new Promise<void>((done) => setTimeout(done, 5));
  }
  throw new Error("expected_intent_execution_fk_lock_wait_not_observed");
}
