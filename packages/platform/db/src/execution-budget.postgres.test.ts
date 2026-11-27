import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  isDatabaseAcquisitionTimeout,
  isDatabaseUnavailable,
  runtimeDatabaseExecutionBudget,
  type DatabaseExecutionBudget,
  type PrismaClient,
} from "./index";
import { createMigratedTestDatabase } from "./postgres-test-fixture";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
let testDatabase: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

function databaseUrl(): string {
  return testDatabase.databaseUrl;
}

function client(executionBudget?: DatabaseExecutionBudget): PrismaClient {
  return createPrismaClient({
    databaseUrl: databaseUrl(),
    poolMax: 1,
    poolConnectionTimeoutMs: 1000,
    transactionTimeoutMs: 5000,
    ...(executionBudget ? { executionBudget } : {}),
  });
}

async function failureOf(operation: PromiseLike<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected_database_failure");
}

async function withLockedWorkspace(
  budget: DatabaseExecutionBudget,
  run: (fixture: {
    readonly prisma: PrismaClient;
    readonly observer: PrismaClient;
    readonly lockedId: string;
    readonly otherId: string;
  }) => Promise<void>,
): Promise<void> {
  const prisma = client(budget);
  const observer = client();
  const locker = client();
  const lockedId = `execution-budget-${randomUUID()}`;
  const otherId = `execution-budget-${randomUUID()}`;
  let release!: () => void;
  let acquired!: () => void;
  let acquisitionFailed!: (error: unknown) => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    acquisitionFailed = reject;
  });
  let owner: Promise<unknown> | undefined;
  try {
    await observer.workspace.createMany({
      data: [lockedId, otherId].map((id) => ({
        id,
        slug: id,
        name: "before",
      })),
    });
    owner = locker.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${lockedId} FOR UPDATE`;
      acquired();
      await held;
    });
    void owner.catch(acquisitionFailed);
    await ready;
    await run({ prisma, observer, lockedId, otherId });
  } finally {
    release();
    await owner?.catch(() => {});
    await observer.workspace.deleteMany({
      where: { id: { in: [lockedId, otherId] } },
    });
    await Promise.all([
      prisma.$disconnect(),
      observer.$disconnect(),
      locker.$disconnect(),
    ]);
  }
}

async function waitForBackendSleep(observer: PrismaClient, pid: number) {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const rows = await observer.$queryRaw<{ sleeping: boolean }[]>`
      SELECT "wait_event" = 'PgSleep' AS sleeping
      FROM pg_stat_activity WHERE pid = ${pid}
    `;
    if (rows[0]?.sleeping) return;
    await delay(5);
  }
  throw new Error("test_backend_did_not_start_sleep");
}

describe.skipIf(!adminUrl)("runtime SQL budgets on real PostgreSQL", () => {
  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase(adminUrl!);
  }, 120_000);
  afterAll(async () => {
    await testDatabase?.cleanup();
  });

  it("enforces runtime startup budgets while preserving administrative and SET LOCAL budgets", async () => {
    const url = new URL(databaseUrl());
    url.searchParams.set(
      "options",
      "-c statement_timeout=0 -c lock_timeout=0 -c timezone=America/Los_Angeles -c application_name=execution-budget-test",
    );
    const runtime = createPrismaClient({
      databaseUrl: url.toString(),
      poolMax: 1,
      executionBudget: runtimeDatabaseExecutionBudget,
    });
    const administrative = createPrismaClient({
      databaseUrl: url.toString(),
      poolMax: 1,
    });
    const settings = (prisma: Pick<PrismaClient, "$queryRaw">) =>
      prisma.$queryRaw`
        SELECT current_setting('statement_timeout') AS statement,
               current_setting('lock_timeout') AS lock,
               current_setting('TimeZone') AS timezone,
               current_setting('application_name') AS application
      `;
    try {
      await expect(settings(runtime)).resolves.toEqual([
        {
          statement: "30s",
          lock: "5s",
          timezone: "UTC",
          application: "execution-budget-test",
        },
      ]);
      await expect(settings(administrative)).resolves.toEqual([
        {
          statement: "0",
          lock: "0",
          timezone: "UTC",
          application: "execution-budget-test",
        },
      ]);
      await runtime.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
          await expect(settings(tx)).resolves.toEqual([
            expect.objectContaining({ statement: "15s", lock: "5s" }),
          ]);
        },
        { timeout: 15_000 },
      );
      await expect(settings(runtime)).resolves.toEqual([
        expect.objectContaining({ statement: "30s", lock: "5s" }),
      ]);
    } finally {
      await Promise.all([runtime.$disconnect(), administrative.$disconnect()]);
    }
  });

  it("cancels a slow raw query on the server and reuses the single pool slot", async () => {
    const prisma = client({ statementTimeoutMs: 100, lockTimeoutMs: 50 });
    try {
      const started = performance.now();
      const error = await failureOf(
        prisma.$queryRaw`SELECT 1 AS value FROM pg_sleep(10)`,
      );
      expect(isDatabaseUnavailable(error)).toBe(true);
      expect(isDatabaseAcquisitionTimeout(error)).toBe(false);
      expect(performance.now() - started).toBeLessThan(1500);
      // adapter-pg may retire the errored backend. Recovery owns the same
      // bounded pool slot without requiring the same physical connection.
      await expect(prisma.$queryRaw`SELECT 2 AS value`).resolves.toEqual([
        { value: 2 },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it.each([
    { statementTimeoutMs: 1500, lockTimeoutMs: 100, cause: "lock" },
    { statementTimeoutMs: 100, lockTimeoutMs: 1500, cause: "statement" },
  ])(
    "bounds model updates by the $cause timeout without retrying the write",
    async (budget) => {
      await withLockedWorkspace(
        budget,
        async ({ prisma, observer, lockedId }) => {
          const started = performance.now();
          const error = await failureOf(
            prisma.workspace.update({
              where: { id: lockedId },
              data: { name: "must-not-commit" },
            }),
          );
          expect(isDatabaseUnavailable(error)).toBe(true);
          expect(isDatabaseAcquisitionTimeout(error)).toBe(false);
          expect(performance.now() - started).toBeLessThan(1500);
          await expect(
            observer.workspace.findUniqueOrThrow({
              where: { id: lockedId },
              select: { name: true },
            }),
          ).resolves.toEqual({ name: "before" });
          await expect(prisma.$queryRaw`SELECT 1 AS value`).resolves.toEqual([
            { value: 1 },
          ]);
        },
      );
    },
  );

  it("rolls back earlier transaction writes after a raw lock timeout and admits healthy work", async () => {
    await withLockedWorkspace(
      { statementTimeoutMs: 1500, lockTimeoutMs: 100 },
      async ({ prisma, observer, lockedId, otherId }) => {
        const error = await failureOf(
          prisma.$transaction(async (tx) => {
            await tx.workspace.update({
              where: { id: otherId },
              data: { name: "must-roll-back" },
            });
            await tx.$executeRaw`
              UPDATE "Workspace" SET "name" = 'must-not-commit'
              WHERE "id" = ${lockedId}
            `;
          }),
        );
        expect(isDatabaseUnavailable(error)).toBe(true);
        expect(isDatabaseAcquisitionTimeout(error)).toBe(false);
        const workspaces = await observer.workspace.findMany({
          where: { id: { in: [lockedId, otherId] } },
          select: { name: true },
        });
        expect(workspaces).toEqual([{ name: "before" }, { name: "before" }]);
        await expect(
          prisma.workspace.update({
            where: { id: otherId },
            data: { name: "healthy" },
            select: { name: true },
          }),
        ).resolves.toEqual({ name: "healthy" });
      },
    );
  });

  it("reconnects after its active backend is terminated without replaying the interrupted query", async () => {
    const prisma = client({ statementTimeoutMs: 4000, lockTimeoutMs: 1000 });
    const observer = client();
    let pid: number | undefined;
    let pending: Promise<unknown> | undefined;
    let terminated = false;
    try {
      [{ pid }] = await prisma.$queryRaw<[{ pid: number }]>`
        SELECT pg_backend_pid() AS pid
      `;
      pending = failureOf(
        prisma.$queryRaw`SELECT 1 AS value FROM pg_sleep(10)`,
      );
      await waitForBackendSleep(observer, pid);
      await observer.$queryRaw`SELECT pg_terminate_backend(${pid})`;
      terminated = true;
      const error = await pending;
      expect(isDatabaseUnavailable(error)).toBe(true);
      expect(isDatabaseAcquisitionTimeout(error)).toBe(false);
      const [healthy] = await prisma.$queryRaw<
        [{ pid: number; value: number }]
      >`
        SELECT pg_backend_pid() AS pid, 2 AS value
      `;
      expect(healthy.value).toBe(2);
      expect(healthy.pid).not.toBe(pid);
    } finally {
      if (pid !== undefined && !terminated) {
        await observer.$queryRaw`SELECT pg_terminate_backend(${pid})`;
      }
      await pending;
      await Promise.all([prisma.$disconnect(), observer.$disconnect()]);
    }
  });

  it("retains an expired transaction until real SQL cancellation and rollback settle", async () => {
    await withLockedWorkspace(
      { statementTimeoutMs: 1500, lockTimeoutMs: 200 },
      async ({ prisma, observer, lockedId, otherId }) => {
        let callbackSettled = false;
        const error = await failureOf(
          prisma.$transaction(
            async (tx) => {
              try {
                await tx.workspace.update({
                  where: { id: otherId },
                  data: { name: "must-roll-back" },
                });
                await tx.workspace.update({
                  where: { id: lockedId },
                  data: { name: "must-not-commit" },
                });
              } finally {
                callbackSettled = true;
              }
            },
            { timeout: 50 },
          ),
        );
        expect(callbackSettled).toBe(true);
        expect(isDatabaseUnavailable(error)).toBe(true);
        await expect(
          observer.workspace.findUniqueOrThrow({
            where: { id: otherId },
            select: { name: true },
          }),
        ).resolves.toEqual({ name: "before" });
        await expect(prisma.$queryRaw`SELECT 1 AS healthy`).resolves.toEqual([
          { healthy: 1 },
        ]);
      },
    );
  });

  it("does not turn constraint failures, invalid SQL or expired application transactions into temporary unavailability", async () => {
    const prisma = client(runtimeDatabaseExecutionBudget);
    try {
      const syntaxError = await failureOf(prisma.$queryRaw`SELECT FROM`);
      const missingTable = await failureOf(
        prisma.$queryRaw`SELECT * FROM "execution_budget_absent_table"`,
      );
      const transactionError = await failureOf(
        prisma.$transaction(
          async (tx) => {
            await delay(100);
            return tx.$queryRaw`SELECT 1`;
          },
          { timeout: 50 },
        ),
      );
      for (const error of [syntaxError, missingTable, transactionError]) {
        expect(isDatabaseUnavailable(error)).toBe(false);
      }
      const id = `execution-budget-${randomUUID()}`;
      try {
        await prisma.workspace.create({ data: { id, slug: id, name: id } });
        const conflict = await failureOf(
          prisma.workspace.create({ data: { id, slug: id, name: id } }),
        );
        expect(isDatabaseUnavailable(conflict)).toBe(false);
      } finally {
        await prisma.workspace.deleteMany({ where: { id } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
