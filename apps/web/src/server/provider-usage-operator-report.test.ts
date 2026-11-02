import { fact } from "../../../../packages/features/provider-usage/src/tests/fixture";
import { selectProjection } from "../../../../packages/features/provider-usage/src/domain/usage";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaOperatorUsageReportReader } from "../../../../packages/features/provider-usage/src/infrastructure/prisma-operator-usage-report-reader";

// Exercise authorization SQL against disposable PostgreSQL, including foreign admins.
describe("operator usage authorization", () => {
  const db = new PGlite();
  const queryRawFor =
    (queryable: Pick<PGlite, "query">) =>
    async (
      sql: { text: string; values: unknown[] } | TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const text = Array.isArray(sql)
        ? sql.reduce(
            (result, part, index) => result + (index ? `$${index}` : "") + part,
            "",
          )
        : (sql as { text: string }).text;
      return (
        await queryable.query(
          text,
          Array.isArray(sql) ? values : (sql as { values: unknown[] }).values,
        )
      ).rows;
    };
  const prisma = {
    $transaction: async <T>(
      call: (tx: { $queryRaw: ReturnType<typeof queryRawFor> }) => Promise<T>,
      options?: { isolationLevel?: string },
    ) => {
      expect(options?.isolationLevel).toBe("RepeatableRead");
      return db.transaction(async (tx) => {
        // Real SQL transaction semantics; concurrent snapshot proof uses PG17.
        await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        return call({ $queryRaw: queryRawFor(tx) });
      });
    },
  } as unknown as PrismaClient;
  const reader = new PrismaOperatorUsageReportReader(prisma, "operator");
  const query = {
    operatorWorkspaceId: "operator",
    actorId: "owner",
    from: new Date("2026-10-01"),
    to: new Date("2026-11-01"),
  };
  beforeAll(async () => {
    await db.exec(
      `CREATE TABLE "Workspace" ("id" text PRIMARY KEY,"deletionState" text); CREATE TABLE "WorkspaceMember" ("workspaceId" text,"userId" text,"role" text); CREATE TABLE "UsageCall" ("workspaceId" text,"occurredAt" timestamptz,"callId" text,"projection" jsonb,"actorId" text,"provider" text,"route" text,"purpose" text,"bindingId" text,"runId" text); CREATE TABLE "UsageSourceCheckpoint" ("workspaceId" text,"sourceInstance" text,"coveredFrom" timestamptz,"asOf" timestamptz,"disabledAt" timestamptz); INSERT INTO "Workspace" VALUES ('operator','active'),('foreign','active'); INSERT INTO "WorkspaceMember" VALUES ('operator','owner','owner'),('operator','admin','admin'),('operator','member','member'),('foreign','foreign-admin','admin');`,
    );
  });
  afterAll(() => db.close());
  it.each(["member", "foreign-admin", "outsider"])(
    "denies %s despite any browser workspace selector",
    async (actorId) => {
      await expect(reader.report({ ...query, actorId })).rejects.toThrow(
        "usage_access_denied",
      );
    },
  );
  it("denies forged operator scope and disabled configuration", async () => {
    await expect(
      reader.report({ ...query, operatorWorkspaceId: "foreign" }),
    ).rejects.toThrow("usage_access_denied");
    await expect(
      new PrismaOperatorUsageReportReader(prisma, undefined).report(query),
    ).rejects.toThrow("usage_access_denied");
  });
  it.each(["owner", "admin"])(
    "allows established operator %s and preserves unknown metrics",
    async (actorId) => {
      const report = await reader.report({ ...query, actorId });
      expect(report.totals.tokens.total).toBeNull();
      expect(report.totals.costs).toEqual([]);
      expect(report.sources).toEqual([]);
    },
  );
  it("aggregates other workspaces while excluding deleted scopes and retaining unknown cost", async () => {
    await db.exec(`INSERT INTO "Workspace" VALUES ('deleted','deleted')`);
    for (const [workspaceId, callId] of [
      ["operator", "a"],
      ["foreign", "b"],
      ["deleted", "c"],
    ]) {
      const sample = fact();
      const projection = selectProjection([
        {
          ...sample,
          cost: null,
          identity: {
            ...sample.identity,
            workspaceId: workspaceId!,
            callId: callId!,
          },
        },
      ]);
      await db.query(
        `INSERT INTO "UsageCall" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          workspaceId,
          new Date("2026-10-21"),
          callId,
          JSON.stringify(projection),
          projection.identity.actorId,
          projection.identity.provider,
          projection.identity.route,
          projection.identity.purpose,
          projection.identity.bindingId,
          projection.identity.runId,
        ],
      );
    }
    const report = await reader.report({ ...query, limit: 1 });
    expect(report.totals.providerAttempts).toBe(2);
    expect(report.totals.tokens.total).toBe(260);
    expect(report.totals.unknownCostCount).toBe(2);
    expect(report.totals.costs).toEqual([]);
    expect(report.rows).toHaveLength(1);
    expect(report.nextCursor).toBe("a");
  });
  it("revoked membership immediately loses aggregate access", async () => {
    await db.exec(`DELETE FROM "WorkspaceMember" WHERE "userId"='owner'`);
    await expect(reader.report(query)).rejects.toThrow("usage_access_denied");
  });
});
