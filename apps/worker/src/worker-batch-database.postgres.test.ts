import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  isDatabaseUnavailable,
} from "@reviewrouter/platform-db";
import { createMigratedTestDatabase } from "../../../packages/platform/db/src/postgres-test-fixture";
import { createWorkerBatchProcessor } from "./worker-batch";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;

describe.skipIf(!adminUrl)(
  "worker ownership through actual SQL cancellation",
  () => {
    let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
    beforeAll(async () => {
      database = await createMigratedTestDatabase(adminUrl!);
    }, 120_000);
    afterAll(async () => {
      await database?.cleanup();
    });

    it("retains the blocked owner, progresses healthy work, then retries only after rollback", async () => {
      const worker = createPrismaClient({
        databaseUrl: database.databaseUrl,
        poolMax: 2,
        executionBudget: { statementTimeoutMs: 3000, lockTimeoutMs: 1500 },
        transactionTimeoutMs: 5000,
      });
      const control = createPrismaClient({
        databaseUrl: database.databaseUrl,
        poolMax: 2,
        transactionTimeoutMs: 10_000,
      });
      const prefix = `worker-database-${randomUUID()}`;
      const lockedId = `${prefix}-locked`;
      const sideEffectId = `${prefix}-side-effect`;
      const healthyId = `${prefix}-healthy`;
      let releaseLock!: () => void;
      let lockReady!: () => void;
      let lockFailed!: (error: unknown) => void;
      const held = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const acquired = new Promise<void>((resolve, reject) => {
        lockReady = resolve;
        lockFailed = reject;
      });
      let queryStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        queryStarted = resolve;
      });
      let healthyCommitted!: () => void;
      const progressed = new Promise<void>((resolve) => {
        healthyCommitted = resolve;
      });
      let firstSettled!: () => void;
      const settled = new Promise<void>((resolve) => {
        firstSettled = resolve;
      });
      let attempts = 0;
      let active = 0;
      let maximumActive = 0;
      let healthyAttempts = 0;
      let failure: unknown;
      let blocker: Promise<unknown> | undefined;
      let processor: ReturnType<typeof createWorkerBatchProcessor> | undefined;
      try {
        await control.workspace.createMany({
          data: [lockedId, sideEffectId, healthyId].map((id) => ({
            id,
            slug: id,
            name: "before",
          })),
        });
        await worker.$queryRaw`SELECT 1`;
        blocker = control.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${lockedId} FOR UPDATE`;
          lockReady();
          await held;
        });
        void blocker.catch(lockFailed);
        await acquired;
        const noop = async () => {};
        processor = createWorkerBatchProcessor(
          {
            sdkGrowthMaintenance: async () => {
              attempts++;
              active++;
              maximumActive = Math.max(maximumActive, active);
              try {
                await worker.$transaction(async (tx) => {
                  await tx.workspace.update({
                    where: { id: sideEffectId },
                    data: { name: "committed" },
                  });
                  queryStarted();
                  await tx.workspace.update({
                    where: { id: lockedId },
                    data: { name: "committed" },
                  });
                });
              } catch (error) {
                failure = error;
                throw error;
              } finally {
                active--;
                if (attempts === 1) firstSettled();
              }
            },
            processOutbox: async () => {
              healthyAttempts++;
              await worker.workspace.update({
                where: { id: healthyId },
                data: { name: `healthy-${healthyAttempts}` },
              });
              healthyCommitted();
              return {
                recoveredStale: 0,
                claimed: 1,
                processed: 1,
                retried: 0,
                deadLettered: 0,
                staleClaims: 0,
              };
            },
            pruneRateLimits: noop,
            pruneActionOidcReplayNonces: noop,
            pruneReviewSnapshots: noop,
            pruneReviewExecutionCheckpoints: noop,
            reviewInvestigationMaintenance: noop,
            memoryMaintenance: noop,
            pruneMemoryUsageTelemetry: noop,
            reviewV2Maintenance: async () => ({
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
            }),
          },
          { signal: new AbortController().signal, observationMs: 25 },
        );

        const first = processor.processBatch();
        await Promise.all([started, progressed]);
        expect((await first).running).toContain("sdk_growth.recovery");
        expect((await processor.processBatch()).running).toContain(
          "sdk_growth.recovery",
        );
        expect(attempts).toBe(1);
        expect(active).toBe(1);
        expect(failure).toBeUndefined();
        expect(healthyAttempts).toBeGreaterThanOrEqual(1);
        await expect(
          control.workspace.findUniqueOrThrow({
            where: { id: healthyId },
            select: { name: true },
          }),
        ).resolves.toEqual({ name: expect.stringMatching(/^healthy-[1-9]/) });

        // Observation never released the slot. PostgreSQL now cancels the real
        // statement, Prisma rolls back the earlier write, and the owner settles.
        await settled;
        expect(isDatabaseUnavailable(failure)).toBe(true);
        expect(active).toBe(0);
        await expect(
          control.workspace.findUniqueOrThrow({
            where: { id: sideEffectId },
            select: { name: true },
          }),
        ).resolves.toEqual({ name: "before" });
        const cancelled = await processor.processBatch();
        expect(cancelled.failures).toEqual([
          expect.objectContaining({ phase: "sdk_growth.recovery" }),
        ]);
        expect(attempts).toBe(1);
        releaseLock();
        await blocker;
        const recovered = await processor.processOnce();
        expect(recovered.failures).toEqual([]);
        expect(attempts).toBe(2);
        expect(maximumActive).toBe(1);
        await expect(
          control.workspace.findUniqueOrThrow({
            where: { id: lockedId },
            select: { name: true },
          }),
        ).resolves.toEqual({ name: "committed" });
      } finally {
        releaseLock();
        await blocker?.catch(() => {});
        await processor?.drain();
        await Promise.all([worker.$disconnect(), control.$disconnect()]);
      }
    });
  },
);
