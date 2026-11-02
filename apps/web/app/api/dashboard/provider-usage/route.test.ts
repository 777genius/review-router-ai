import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fact } from "../../../../../../packages/features/provider-usage/src/tests/fixture";
import { selectProjection } from "../../../../../../packages/features/provider-usage/src/domain/usage";
vi.mock("../../../../src/server/dashboard-mutations", () => ({
  getDashboardSignedInActor: vi.fn(),
}));
vi.mock("../../../../src/server/prisma", () => ({ getPrisma: vi.fn() }));
import { getDashboardSignedInActor } from "../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../src/server/prisma";
import { PrismaUsageReportReader } from "@reviewrouter/features-provider-usage/composition";
import { GET } from "./route";

// Real report SQL and server authorization through the actual GET boundary.
// PGlite verifies SQL semantics; hosted acceptance separately uses migrated PG17.
describe("tenant usage API and SQL scope", () => {
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
  const queryRaw = queryRawFor(db);
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: async <T>(
      call: (tx: { $queryRaw: typeof queryRaw }) => Promise<T>,
      options?: { isolationLevel?: string },
    ) => {
      expect(options?.isolationLevel).toBe("RepeatableRead");
      return db.transaction(async (tx) => {
        // Real SQL transaction semantics; concurrent snapshot proof uses PG17.
        await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        return call({ $queryRaw: queryRawFor(tx) });
      });
    },
    workspaceMember: {
      findFirst: async ({
        where,
      }: {
        where: { workspaceId: string; userId: string };
      }) =>
        (
          await db.query(
            'SELECT "role" FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2',
            [where.workspaceId, where.userId],
          )
        ).rows[0] ?? null,
    },
    workspace: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (
          await db.query(
            'SELECT "deletionState","personalOwnerUserId" FROM "Workspace" WHERE "id"=$1',
            [where.id],
          )
        ).rows[0] ?? null,
    },
  } as unknown as PrismaClient;
  const get = (params = "", workspace = "w") =>
    GET(
      new NextRequest(
        `http://localhost/api/dashboard/provider-usage?workspace=${workspace}&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&purpose=review${params}`,
      ),
    );
  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE "Workspace" ("id" text PRIMARY KEY,"deletionState" text,"personalOwnerUserId" text);
      CREATE TABLE "WorkspaceMember" ("workspaceId" text,"userId" text,"role" text);
      CREATE TABLE "UsageCall" ("callId" text,"workspaceId" text,"actorId" text,"occurredAt" timestamptz,"provider" text,"route" text,"purpose" text,"bindingId" text,"runId" text,"projection" jsonb);
      CREATE TABLE "UsageUnattributedObservation" ("workspaceId" text,"observedAt" timestamptz,"resolvedAt" timestamptz);
      CREATE TABLE "UsageSourceCheckpoint" ("workspaceId" text,"disabledAt" timestamptz,"sourceInstance" text,"coveredFrom" timestamptz,"asOf" timestamptz,"failureCount" int,"nextAttemptAt" timestamptz,"deadLetteredAt" timestamptz,"lastErrorCode" text);
      CREATE TABLE "ProviderUsageGrant" ("workspaceId" text,"actorId" text,"issuedAt" timestamptz,"expiresAt" timestamptz,"purpose" text,"runId" text,"bindingId" text,"invocationId" text,"producerCoverage" jsonb);
      INSERT INTO "Workspace" VALUES ('w','active',null),('foreign','active',null),('deleted','deleted',null),('personal','active','member');
      INSERT INTO "WorkspaceMember" VALUES ('w','member','member'),('w','other','member'),('w','admin','admin'),('deleted','member','owner');
    `);
    for (const [
      id,
      workspaceId,
      actorId,
      provider,
      requestedModel,
      runId,
      granularity,
    ] of [
      ["a", "w", "member", "A", "X", "run-a", "call"],
      ["b", "w", "member", "B", "Y", "run-a", "call"],
      ["s", "w", "member", "A", "X", "run-a", "turn"],
      ["c", "w", "member", "A", "X", "run-z", "call"],
      ["d", "w", "other", "C", "Z", "other-run", "call"],
      [
        "f",
        "foreign",
        "member",
        "SECRET",
        "FOREIGN_MODEL",
        "foreign-run",
        "call",
      ],
    ] as const) {
      const projection = selectProjection([
        fact({
          identity: {
            ...fact().identity,
            callId: id,
            workspaceId,
            actorId,
            provider,
            requestedModel,
            runId,
            granularity,
            parentScope: "turn",
          },
          actualProvider: "observed-upstream",
          actualModel: "observed-alias",
          ...(granularity === "turn"
            ? {
                childCallIds: ["a", "b"],
                tokens: { ...fact().tokens, total: 999, inputTotal: 969 },
              }
            : {}),
        }),
      ]);
      await db.query(
        'INSERT INTO "UsageCall" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          workspaceId,
          actorId,
          new Date(projection.identity.occurredAt),
          provider,
          "gateway",
          "review",
          null,
          runId,
          JSON.stringify(projection),
        ],
      );
    }
    vi.mocked(getPrisma).mockReturnValue(prisma);
  });
  afterAll(() => db.close());
  function actor(userId: string | null) {
    vi.mocked(getDashboardSignedInActor).mockResolvedValue(
      userId ? ({ userId } as never) : null,
    );
  }
  it("passes exact model/run cursor through GET, keeps facets in actor scope, and selects authority before provider/model filters", async () => {
    actor("member");
    const response = await get("&provider=A&model=X&runAfter=run-a");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { scope, report } = await response.json();
    expect(scope).toEqual({
      actorId: "member",
      workspaceId: "w",
      effectiveAccess: "member",
    });
    expect(report.totals.tokens.total).toBe(260);
    expect(report.attempts).toBe(2);
    expect(report.logicalRuns).toBe(2);
    expect(report.overview.runs.map((r: { runId: string }) => r.runId)).toEqual(
      ["run-z"],
    );
    expect(report.overview.facets.providers).toEqual(["A", "B"]);
    expect(report.overview.models[0]).toMatchObject({
      provider: "A",
      requestedModel: "X",
      observedModels: ["observed-alias"],
    });
    expect(report.rows.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    for (const internal of [
      "authorizationId",
      "actorId",
      "workspaceId",
      "repositoryId",
      "bindingId",
      "parentScope",
      "SECRET",
      "FOREIGN_MODEL",
      "auth-1",
    ])
      expect(JSON.stringify(report)).not.toContain(internal);
  });
  it("retains admin scope and filters direct reader model by requested rather than actual model", async () => {
    actor("admin");
    const { report, scope } = await (await get()).json();
    expect(scope).toEqual({
      actorId: "admin",
      workspaceId: "w",
      effectiveAccess: "admin",
    });
    expect(report.overview.facets.providers).toEqual(["A", "B", "C"]);
    expect(report.attempts).toBe(4);
    const reader = new PrismaUsageReportReader(prisma);
    const query = {
      workspaceId: "w",
      actorId: "member",
      access: "member" as const,
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
      provider: "A",
    };
    expect(
      (await reader.read({ ...query, model: "X" })).map(
        (p) => p.identity.callId,
      ),
    ).toEqual(["a", "c", "s"]);
    expect(await reader.read({ ...query, model: "observed-alias" })).toEqual(
      [],
    );
  });
  it("denies foreign/repository-only, inactive and signed-out access while allowing personal ownership", async () => {
    actor("member");
    const forbidden = await get("", "foreign");
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");
    expect((await get("", "deleted")).status).toBe(403);
    expect((await get("", "personal")).status).toBe(200);
    actor("repository-only");
    expect((await get()).status).toBe(403);
    actor(null);
    expect((await get()).status).toBe(401);
  });
  it("accepts the 366-day boundary and rejects overlong, invalid, reversed, or unbounded exact IDs", async () => {
    actor("member");
    const request = (params: string) =>
      GET(
        new NextRequest(
          `http://localhost/api/dashboard/provider-usage?workspace=w&${params}`,
        ),
      );
    expect(
      (await request("from=2025-10-01T00:00:00Z&to=2026-10-02T00:00:00Z"))
        .status,
    ).toBe(200);
    for (const params of [
      "from=2025-10-01&to=2026-10-03",
      "from=invalid&to=2026-10-21",
      "from=2026-02-30&to=2026-03-02",
      "from=2026-10-22&to=2026-10-21",
      "from=&to=2026-10-21",
      "model=",
      `model=${"x".repeat(257)}`,
      "provider=A%0AB",
      "runAfter=bad%00cursor",
    ])
      expect((await request(params)).status).toBe(400);
    const { report: unknown } = await (
      await get("&model=unknown-valid-id")
    ).json();
    expect(unknown.rows).toEqual([]);
    expect(unknown.totals.tokens.total).toBeNull();
  });
});
