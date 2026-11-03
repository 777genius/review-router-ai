import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { readPrismaUsagePeriodReport } from "../infrastructure/prisma-usage-report";
import { fact } from "./fixture";
import { selectProjection } from "../domain/usage";
import {
  usageRequestedProviderJoinSql,
  usageRequestedProviderSql,
} from "../infrastructure/usage-requested-provider-sql";

// Explicit disposable-test endpoint only; never read application DATABASE_URL.
const adminUrl = process.env.USAGE_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)(
  "historical requested-provider attribution on PostgreSQL",
  () => {
    let client: Client;
    let admin: Client;
    const database = `TEST_usage_attribution_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    beforeAll(async () => {
      admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(
        `CREATE DATABASE "${database}" ENCODING 'UTF8' TEMPLATE template0`,
      );
      created = true;
      const url = new URL(adminUrl!);
      url.pathname = `/${database}`;
      client = new Client({ connectionString: url.toString() });
      await client.connect();
      await client.query("BEGIN");
      // Session-local fixtures shadow operational tables without reading/writing
      // any application row. Only columns used by the projection are represented.
      await client.query(`CREATE TEMP TABLE "UsageCall" (
      "callId" text,"workspaceId" text,"runId" text,"provider" text,
      "route" text,"bindingId" text,"projection" jsonb,"actorId" text,
      "purpose" text DEFAULT 'review',"occurredAt" timestamptz DEFAULT '2026-10-21');
      CREATE TEMP TABLE "ReviewRunAuthorization" (
      "authorizationId" text PRIMARY KEY,"workspaceId" text,"sourceRunId" text,
      "sourceRunAttempt" text,"runtimeSnapshotCanonicalJson" text)`);
      await client.query("SAVEPOINT usage_case");
    }, 30_000);
    beforeEach(async () => {
      await client.query("ROLLBACK TO SAVEPOINT usage_case");
      await client.query(
        'TRUNCATE pg_temp."UsageCall",pg_temp."ReviewRunAuthorization"',
      );
    });
    afterAll(async () => {
      if (client) {
        await client.query("ROLLBACK");
        await client.end();
      }
      if (created) await admin.query(`DROP DATABASE "${database}"`);
      if (admin) await admin.end();
    }, 30_000);
    const allocation = {
      profileRef: "openrouter-openai-responses-apikey-v1",
      bindingId: "binding",
      invocationId: "invocation",
      attemptId: "attempt",
    };
    async function seed(snapshot: unknown, auth: Record<string, string> = {}) {
      const identity = {
        authorizationId: "authorization",
        runAttempt: 1,
        invocationId: "invocation",
        attemptId: "attempt",
        provider: "codex",
        requestedModel: "an-opaque-model",
      };
      await client.query(
        `INSERT INTO pg_temp."UsageCall"
      ("callId","workspaceId","runId","provider","route","bindingId","projection") VALUES
      ('call','workspace','run','codex','gateway','binding',$1::jsonb)`,
        [
          JSON.stringify({
            identity,
            usage: {
              actualProvider: null,
              actualModel: null,
              tokens: { total: 7 },
            },
          }),
        ],
      );
      await client.query(
        `INSERT INTO pg_temp."ReviewRunAuthorization" VALUES($1,$2,$3,$4,$5)`,
        [
          auth.id ?? "authorization",
          auth.workspace ?? "workspace",
          auth.run ?? "run",
          auth.runAttempt ?? "1",
          typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
        ],
      );
    }
    async function read(provider?: string) {
      const query = Prisma.sql`SELECT ${usageRequestedProviderSql()} AS provider,
      u."projection" FROM pg_temp."UsageCall" u ${usageRequestedProviderJoinSql()}
      ${provider ? Prisma.sql`WHERE ${usageRequestedProviderSql()}=${provider}` : Prisma.empty}`;
      return (await client.query(query.text, query.values)).rows;
    }
    it.each([3, 4])(
      "corrects a uniquely bound v%s snapshot without changing source identity or observed values",
      async (version) => {
        await seed(
          version === 3
            ? { snapshotVersion: 3, gateway: allocation }
            : {
                snapshotVersion: 4,
                allocations: [
                  { ...allocation, bindingId: "sibling" },
                  allocation,
                ],
              },
        );
        const [row] = await read("openrouter");
        expect(row.provider).toBe("openrouter");
        expect(row.projection).toEqual({
          identity: {
            authorizationId: "authorization",
            runAttempt: 1,
            invocationId: "invocation",
            attemptId: "attempt",
            provider: "codex",
            requestedModel: "an-opaque-model",
          },
          usage: {
            actualProvider: null,
            actualModel: null,
            tokens: { total: 7 },
          },
        });
        expect(await read("codex")).toEqual([]);
      },
    );
    it.each([
      { workspace: "other-workspace" },
      { run: "other-run" },
      { runAttempt: "2" },
      { id: "other-authorization" },
    ])("does not cross an authorization scope boundary: %j", async (auth) => {
      await seed({ snapshotVersion: 3, gateway: allocation }, auth);
      expect((await read())[0].provider).toBe("codex");
    });
    it.each([
      { ...allocation, bindingId: "other-binding" },
      { ...allocation, invocationId: "other-invocation" },
      { ...allocation, attemptId: "other-attempt" },
      { ...allocation, profileRef: "openai-responses-apikey-v1" },
      { ...allocation, profileRef: "unknown" },
    ])(
      "does not infer provider from a mismatching tuple or generic profile: %j",
      async (gateway) => {
        await seed({ snapshotVersion: 3, gateway });
        expect((await read())[0].provider).toBe("codex");
      },
    );
    it.each([
      "invalid JSON",
      { snapshotVersion: "3", gateway: allocation },
      { snapshotVersion: 5, gateway: allocation },
      { snapshotVersion: 4, allocations: "invalid" },
      { snapshotVersion: 4, allocations: [allocation, allocation] },
      {
        snapshotVersion: 4,
        allocations: [allocation, { ...allocation, profileRef: "unknown" }],
      },
      {
        snapshotVersion: 4,
        allocations: [
          allocation,
          { ...allocation, profileRef: "openai-responses-apikey-v1" },
        ],
      },
    ])(
      "fails closed for malformed, unsupported or ambiguous snapshots: %j",
      async (snapshot) => {
        await seed(snapshot);
        expect((await read())[0].provider).toBe("codex");
      },
    );
    it("leaves direct calls alone even when the snapshot matches", async () => {
      await seed({ snapshotVersion: 3, gateway: allocation });
      await client.query("UPDATE pg_temp.\"UsageCall\" SET route='direct'");
      expect((await read())[0].provider).toBe("codex");
    });
    it("uses one corrected label consistently in report filters, facets, ranks and rows while preserving tokens and raw identity", async () => {
      await seed({ snapshotVersion: 3, gateway: allocation });
      const projection = selectProjection([
        fact({
          actualProvider: null,
          actualModel: null,
          identity: {
            ...fact().identity,
            callId: "call",
            workspaceId: "workspace",
            runId: "run",
            authorizationId: "authorization",
            bindingId: "binding",
            provider: "codex",
            invocationId: "invocation",
            attemptId: "attempt",
            requestedModel: "opaque-model",
          },
        }),
      ]);
      await client.query(
        'UPDATE pg_temp."UsageCall" SET projection=$1::jsonb',
        [JSON.stringify(projection)],
      );
      const tx = {
        $queryRaw: async (query: Prisma.Sql) =>
          (await client.query(query.text, query.values)).rows,
      } as unknown as Prisma.TransactionClient;
      const query = {
        workspaceId: "workspace",
        actorId: null,
        access: "admin" as const,
        from: new Date("2026-10-01"),
        to: new Date("2026-11-01"),
        provider: "openrouter",
        model: "opaque-model",
      };
      const report = await readPrismaUsagePeriodReport(tx, query);
      expect(report.overview.facets).toEqual({
        providers: ["openrouter"],
        models: [{ provider: "openrouter", requestedModel: "opaque-model" }],
      });
      expect(report.totals.tokens.total).toBe(130);
      expect(report.rows).toEqual([
        { ...projection, requestedProvider: "openrouter" },
      ]);
      expect(report.groups).toMatchObject([
        { provider: "openrouter", model: null },
      ]);
      expect(
        (await readPrismaUsagePeriodReport(tx, { ...query, provider: "codex" }))
          .rows,
      ).toEqual([]);
      expect(
        (
          await client.query(
            'SELECT provider,projection FROM pg_temp."UsageCall"',
          )
        ).rows,
      ).toEqual([{ provider: "codex", projection }]);
    });
  },
);
