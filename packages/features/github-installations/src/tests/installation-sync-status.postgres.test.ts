import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPrismaClient,
  runtimeDatabaseExecutionBudget,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { createMigratedTestDatabase } from "../../../../platform/db/src/postgres-test-fixture";
import { PrismaInstallationSyncStatusReader } from "../infrastructure/outbox/prisma-installation-sync-status-reader";
import {
  installationSyncAggregateId,
  installationSyncRequestedEvent,
} from "../infrastructure/outbox/outbox-installation-sync-requester";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
const statuses = [
  "pending",
  "processing",
  "retry_wait",
  "processed",
  "dead_letter",
] as const;

describe.skipIf(!adminUrl)("installation scan status PostgreSQL read", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let prisma: PrismaClient;
  const prefix = `installation-status-${randomUUID()}`;
  const installationIds = statuses.map((_, i) => `${prefix}-${i}`);
  const requestedAt = new Date("2026-11-27T12:00:00.000Z");

  beforeAll(async () => {
    database = await createMigratedTestDatabase(adminUrl!);
    prisma = createPrismaClient({
      databaseUrl: database.databaseUrl,
      poolMax: 1,
      executionBudget: runtimeDatabaseExecutionBudget,
    });
    const parents = [
      ...installationIds,
      ...Array.from({ length: 100 }, (_, i) => `${prefix}-other-tenant-${i}`),
    ];
    // Five response rows, despite 13,440 historical events and unrelated tenants.
    for (const installationId of parents) {
      await prisma.outboxEvent.createMany({
        data: Array.from({ length: 128 }, (_, version) => ({
          id: `${installationId}-history-${version}`,
          ...installationSyncRequestedEvent,
          idempotencyKey: `${installationId}-history-${version}`,
          workspaceId: installationIds.includes(installationId)
            ? `${prefix}-authorized`
            : `${prefix}-other-tenant`,
          aggregateId: installationSyncAggregateId(installationId),
          payload: {},
          status: "processed" as const,
          occurredAt: requestedAt,
          createdAt: new Date(requestedAt.getTime() - 1000 - version),
        })),
      });
    }
    await prisma.outboxEvent.createMany({
      data: installationIds.flatMap((installationId, i) => {
        const base = {
          ...installationSyncRequestedEvent,
          workspaceId: `${prefix}-authorized`,
          aggregateId: installationSyncAggregateId(installationId),
          payload: {},
          occurredAt: requestedAt,
          createdAt: requestedAt,
        };
        return [
          {
            ...base,
            id: `${installationId}-head-a`,
            idempotencyKey: `${installationId}-head-a`,
            status: "processed" as const,
          },
          {
            ...base,
            id: `${installationId}-head-z`,
            idempotencyKey: `${installationId}-head-z`,
            status: statuses[i]!,
          },
          {
            ...base,
            id: `${installationId}-other-type`,
            idempotencyKey: `${installationId}-other-type`,
            type: "another.event",
            status: "processing" as const,
            createdAt: new Date(requestedAt.getTime() + 1000),
          },
          {
            ...base,
            id: `${installationId}-other-version`,
            idempotencyKey: `${installationId}-other-version`,
            version: 2,
            status: "processing" as const,
            createdAt: new Date(requestedAt.getTime() + 1000),
          },
        ];
      }),
    });
    await prisma.$executeRaw`ANALYZE "OutboxEvent"`;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.cleanup();
  });

  it("returns one deterministic latest status per authorized parent in one query", async () => {
    const read = vi.spyOn(prisma, "$queryRaw");
    try {
      const requested = [...installationIds].reverse();
      const rows = await new PrismaInstallationSyncStatusReader(
        prisma,
      ).latestByInstallation([
        ...requested,
        installationIds[0]!,
        `${prefix}-absent`,
        '\'; DELETE FROM "OutboxEvent"; --',
      ]);
      expect(read).toHaveBeenCalledOnce();
      expect([...rows]).toEqual(
        requested.map((id) => [
          id,
          {
            status: statuses[installationIds.indexOf(id)],
            requestedAt,
          },
        ]),
      );
      expect(rows.size).toBe(installationIds.length);
      const [template, ...values] = read.mock.calls[0]!;
      const query = Prisma.sql(template as TemplateStringsArray, ...values);
      const plan = await prisma.$queryRawUnsafe<
        { "QUERY PLAN": { Plan: PlanNode }[] }[]
      >(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
        ...query.values,
      );
      expect(usesLatestIndex(plan[0]!["QUERY PLAN"][0]!.Plan)).toBe(true);
      const genericPlan = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL plan_cache_mode = force_generic_plan`;
        await tx.$executeRawUnsafe(
          `PREPARE installation_latest(text[], text[]) AS ${query.text}`,
        );
        try {
          return await tx.$queryRaw<{ "QUERY PLAN": { Plan: PlanNode }[] }[]>`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            EXECUTE installation_latest(ARRAY['missing'], ARRAY['github-installation:missing'])
          `;
        } finally {
          await tx.$executeRaw`DEALLOCATE installation_latest`;
        }
      });
      expect(usesLatestIndex(genericPlan[0]!["QUERY PLAN"][0]!.Plan)).toBe(
        true,
      );
    } finally {
      read.mockRestore();
    }
    expect(await prisma.outboxEvent.count()).toBe(13_460);
  });

  it("does not broaden an empty authorized set into a database read", async () => {
    const read = vi.spyOn(prisma, "$queryRaw");
    try {
      await expect(
        new PrismaInstallationSyncStatusReader(prisma).latestByInstallation([]),
      ).resolves.toEqual(new Map());
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});

type PlanNode = {
  readonly "Index Name"?: string;
  readonly Plans?: readonly PlanNode[];
};
function usesLatestIndex(plan: PlanNode): boolean {
  return (
    plan["Index Name"] === "OutboxEvent_installation_sync_latest_idx" ||
    (plan.Plans ?? []).some(usesLatestIndex)
  );
}
