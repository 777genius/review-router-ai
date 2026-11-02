import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { fact } from "./fixture";
import {
  PrismaUsageStore,
  PrismaUsageReportReader,
} from "../infrastructure/prisma-usage-store";
import { PrismaUsageReconciliation } from "../infrastructure/prisma-usage-reconciliation";
import { PrismaOperatorUsageReportReader } from "../infrastructure/prisma-operator-usage-report-reader";
import {
  selectProjection,
  type UsageFact,
  type UsageProjection,
} from "../domain/usage";
import { buildUsagePeriodReport } from "../application/report-usage";
import type { UsageReportQuery } from "../application/ports";
import { qualifyUsageSqlReport } from "./usage-sql-qualification";
const adminUrl = process.env.USAGE_TEST_POSTGRES_ADMIN_URL;
// Opt-in dedicated disposable DB; no application DATABASE_URL is read.
describe.skipIf(!adminUrl)("usage ledger real PostgreSQL", () => {
  const dbName = "TEST_usage_" + randomUUID().replaceAll("-", "");
  let prisma: PrismaClient;
  let databaseUrl: string;
  let store: PrismaUsageStore;
  let databaseCreated = false;
  let initialRoles: string[] = [];
  const roles = () =>
    execFileSync(
      "psql",
      [
        adminUrl!,
        "-Atc",
        "SELECT rolname FROM pg_roles WHERE rolname LIKE 'reviewrouter_%'",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
  let scratch: string | undefined;
  const now = new Date("2026-10-21T12:00:00Z");
  const context = {
    workspaceId: "workspace-1",
    invocationId: "invocation-1",
    source: "native" as const,
    now,
    replayUntil: new Date("2026-11-01"),
  };
  function reportProjection(
    scope: string,
    id: string,
    identity: Partial<UsageFact["identity"]> = {},
    overrides: Partial<UsageFact> = {},
  ): UsageProjection {
    return selectProjection([
      fact({
        authority: identity.route === "direct" ? "runtime" : "native",
        ...overrides,
        eventId: `${scope}-${id}`,
        identity: {
          ...fact().identity,
          workspaceId: scope,
          callId: `${scope}-${id}`,
          runId: `${scope}-run`,
          parentScope: scope,
          ...identity,
        },
      }),
    ]);
  }
  async function seedReport(
    scope: string,
    rows: readonly UsageProjection[],
    deletionState: "active" | "delete_pending" = "active",
  ) {
    await prisma.workspace.create({
      data: { id: scope, slug: scope, name: scope, deletionState },
    });
    await prisma.usageCall.createMany({
      data: rows.map((projection) => ({
        callId: projection.identity.callId,
        workspaceId: projection.identity.workspaceId,
        actorId: projection.identity.actorId,
        provider: projection.identity.provider,
        route: projection.identity.route,
        bindingId: projection.identity.bindingId,
        runId: projection.identity.runId,
        purpose: projection.identity.purpose,
        occurredAt: new Date(projection.identity.occurredAt),
        identityHash: "report-fixture",
        projection: projection as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  const reportQuery = (scope: string): UsageReportQuery => ({
    workspaceId: scope,
    actorId: null,
    access: "admin",
    from: new Date("2026-10-01"),
    to: new Date("2026-11-01"),
  });
  const measured = (total: number | null, amount: string | null = "0.1") => ({
    tokens: {
      inputTotal: total,
      outputTotal: total === null ? null : 0,
      cacheRead: total === null ? null : 0,
      cacheWrite: total === null ? null : 0,
      reasoning: total === null ? null : 0,
      total,
    },
    cost: amount === null ? null : { ...fact().cost!, amount },
  });
  beforeAll(async () => {
    initialRoles = roles();
    execFileSync(
      "psql",
      [adminUrl!, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${dbName}"`],
      { stdio: "pipe" },
    );
    databaseCreated = true;
    const url = new URL(adminUrl!);
    url.pathname = "/" + dbName;
    databaseUrl = url.toString();
    const migrations = "packages/platform/db/prisma/migrations";
    const sql = readdirSync(migrations)
      .sort()
      .filter((name) => name !== "migration_lock.toml")
      .map((name) =>
        readFileSync(join(migrations, name, "migration.sql"), "utf8"),
      )
      .join("\n");
    mkdirSync("tmp", { recursive: true });
    scratch = mkdtempSync("tmp/usage-migration-");
    const sqlPath = join(scratch, "migrations.sql");
    writeFileSync(sqlPath, sql);
    try {
      execFileSync(
        "psql",
        [url.toString(), "-v", "ON_ERROR_STOP=1", "-f", sqlPath],
        { stdio: "pipe", timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error) {
      console.error(String((error as { stderr: Buffer }).stderr));
      throw error;
    }
    prisma = createPrismaClient({ databaseUrl: url.toString() });
    store = new PrismaUsageStore(prisma);
    await prisma.workspace.createMany({
      data: [
        { id: "workspace-1", slug: "usage-test-1", name: "Usage test" },
        { id: "workspace-2", slug: "usage-test-2", name: "Other" },
      ],
    });
  }, 60000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (databaseCreated)
      execFileSync(
        "psql",
        [
          adminUrl!,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
        ],
        { stdio: "pipe" },
      );
    for (const role of roles().filter((role) => !initialRoles.includes(role))) {
      if (!/^reviewrouter_[a-z_]+$/.test(role))
        throw new Error("usage_test_role_invalid");
      execFileSync(
        "psql",
        [adminUrl!, "-v", "ON_ERROR_STOP=1", "-c", `DROP ROLE "${role}"`],
        { stdio: "pipe" },
      );
    }
  });
  it("serializes concurrent retry, commits one fact/projection and ACK replay stays no-op", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.ingest(fact(), context)),
    );
    expect(results.filter((r) => r.status === "accepted")).toHaveLength(1);
    expect(await prisma.usageSourceFact.count()).toBe(1);
    expect(await prisma.usageCall.count()).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { type: "provider_usage.fact_accepted" },
      }),
    ).toBe(0);
    await expect(
      store.ingest(
        { ...fact(), tokens: { ...fact().tokens, total: null } },
        context,
      ),
    ).rejects.toThrow("usage_hash_conflict");
    expect(await prisma.usageIngestionConflict.count()).toBe(1);
  });
  it("retains late lower revisions without rolling back authoritative usage and dedupes runner context", async () => {
    const revised = fact({
      revision: 3,
      correctionReason: "upstream correction",
      tokens: { ...fact().tokens, inputTotal: 170, total: 200 },
    });
    await store.ingest(revised, context);
    await store.ingest(
      fact({ revision: 2, correctionReason: "late correction" }),
      context,
    );
    await store.ingest(
      fact({
        authority: "runner",
        sourceInstance: "runner",
        eventId: "runner",
      }),
      { ...context, source: "runner" },
    );
    const rows = await new PrismaUsageReportReader(prisma).read({
      workspaceId: "workspace-1",
      actorId: null,
      access: "admin",
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage?.tokens.total).toBe(200);
  });
  it("filters tenants and member attribution in SQL; immutable identity conflicts persist", async () => {
    const foreign = fact({
      sourceInstance: "foreign",
      eventId: "foreign",
      identity: {
        ...fact().identity,
        callId: "foreign",
        workspaceId: "workspace-2",
        actorId: null,
      },
    });
    await store.ingest(foreign, { ...context, workspaceId: "workspace-2" });
    const reader = new PrismaUsageReportReader(prisma);
    const query = {
      workspaceId: "workspace-1",
      actorId: "someone-else",
      access: "member" as const,
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
    };
    expect(await reader.read(query)).toEqual([]);
    expect(
      (await reader.report({ ...query, access: "admin" })).totals.tokens.total,
    ).toBe(200);
    await expect(
      store.ingest(
        fact({
          eventId: "forged",
          identity: { ...fact().identity, workspaceId: "workspace-2" },
        }),
        { ...context, workspaceId: "workspace-2" },
      ),
    ).rejects.toThrow("usage_identity_conflict");
  });
  it("atomically reuses prepared identity and estimates only the projection from a server snapshot", async () => {
    const captured = {
      provider: "openai",
      model: "gpt-test",
      tier: "standard" as const,
      currency: "USD",
      unit: "million_tokens" as const,
      source: "models.dev",
      version: "a".repeat(64),
      asOf: "2026-10-21T09:00:00.000Z",
      inputPerMillion: "1",
      outputPerMillion: "2",
      cacheReadPerMillion: "0.5",
      cacheWritePerMillion: "1.5",
    };
    const prepared = fact({
      authority: "lifecycle",
      eventId: "prepared",
      state: "prepared",
      dispatchEffect: "effect_unknown",
      identity: {
        ...fact().identity,
        callId: "prepared-call",
        workspaceId: "workspace-2",
      },
    });
    const c = {
      ...context,
      workspaceId: "workspace-2",
      serverPriceSnapshot: captured,
    };
    const identities = await Promise.all([
      store.prepare(prepared, c),
      store.prepare(
        {
          ...prepared,
          identity: {
            ...prepared.identity,
            occurredAt: "2026-10-21T10:00:01.000Z",
          },
        },
        c,
      ),
    ]);
    expect(identities[0]).toEqual(identities[1]);
    expect(
      await prisma.usageSourceFact.count({ where: { eventId: "prepared" } }),
    ).toBe(1);
    const terminal = fact({
      eventId: "prepared-terminal",
      identity: identities[0]!,
      cost: null,
      serviceTier: "standard",
    });
    await store.ingest(terminal, c);
    const projection = (
      await prisma.usageCall.findUniqueOrThrow({
        where: { callId: "prepared-call" },
      })
    ).projection as unknown as import("../domain/usage").UsageProjection;
    expect(projection.usage?.cost?.amount).toBe("0.000155");
    const raw = (
      await prisma.usageSourceFact.findFirstOrThrow({
        where: { eventId: "prepared-terminal" },
      })
    ).fact as unknown as import("../domain/usage").UsageFact;
    expect(raw.cost).toBeNull();
    expect(Object.hasOwn(raw, "priceSnapshot")).toBe(false);
    await expect(
      store.ingest(terminal, {
        ...c,
        serverPriceSnapshot: {
          ...captured,
          inputPerMillion: "999",
          version: "b".repeat(64),
        },
      }),
    ).resolves.toMatchObject({ status: "duplicate" });
    const replayed = (
      await prisma.usageCall.findUniqueOrThrow({
        where: { callId: "prepared-call" },
      })
    ).projection as unknown as import("../domain/usage").UsageProjection;
    expect(replayed.usage?.cost?.amount).toBe("0.000155");
  });
  it("rolls back entire page on stale checkpoint or later fact failure", async () => {
    const reconciliation = new PrismaUsageReconciliation(prisma);
    const lease = await reconciliation.claim({
      sourceInstance: "page-source",
      workspaceId: "workspace-1",
      owner: "poller",
      now,
      leaseMs: 60000,
      coveredFrom: now,
    });
    expect(lease).not.toBeNull();
    const first = fact({
      sourceInstance: "page-source",
      eventId: "page-good",
      identity: { ...fact().identity, callId: "page-good" },
    });
    const bad = fact({
      sourceInstance: "page-source",
      eventId: "page-bad",
      identity: { ...fact().identity, callId: "call-1", actorId: "forged" },
    });
    await expect(
      reconciliation.commitPage(
        lease!,
        {
          facts: [first, bad],
          cursor: "page-1",
          highWaterMark: "water-1",
          complete: true,
        },
        context,
      ),
    ).rejects.toThrow("usage_identity_conflict");
    expect(
      await prisma.usageSourceFact.count({ where: { eventId: "page-good" } }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: "page-good" } }),
    ).toBe(0);
    expect(
      (
        await prisma.usageSourceCheckpoint.findUnique({
          where: { sourceInstance: "page-source" },
        })
      )?.cursor,
    ).toBeNull();
    await expect(
      reconciliation.commitPage(
        { ...lease!, fence: lease!.fence + 1n },
        {
          facts: [first],
          cursor: "page-1",
          highWaterMark: "water-1",
          complete: true,
        },
        context,
      ),
    ).rejects.toThrow("usage_checkpoint_stale");
    await reconciliation.commitPage(
      lease!,
      {
        facts: [first],
        cursor: "page-1",
        highWaterMark: "water-1",
        complete: true,
      },
      context,
    );
    expect(
      await prisma.usageSourceFact.count({ where: { eventId: "page-good" } }),
    ).toBe(1);
    expect(
      (
        await prisma.usageSourceCheckpoint.findUnique({
          where: { sourceInstance: "page-source" },
        })
      )?.cursor,
    ).toBe("page-1");
  });
  it("keeps producer loss capsules tenant and actor scoped and fences retry dead letters", async () => {
    const capsule = {
      schemaVersion: 1,
      revision: 2,
      state: "partial",
      reason: "spool_overflow",
      droppedEvents: 3,
      occurredAt: "2026-10-21T12:00:00.000Z",
    };
    await prisma.providerUsageGrant.create({
      data: {
        id: "coverage-grant",
        tokenHash: "coverage-hash",
        workspaceId: "workspace-1",
        invocationId: "coverage-invocation",
        repositoryId: "123",
        runId: "456",
        runAttempt: 1,
        authorizationId: "auth-coverage",
        actorId: "actor-1",
        producerDigest: "a".repeat(64),
        workflowIdentity: "workflow",
        jobIdentity: "job",
        publicKey: "test-key",
        issuedAt: new Date("2026-10-21T10:00:00Z"),
        expiresAt: new Date("2026-10-28T12:00:00Z"),
        producerCoverage: capsule,
      },
    });
    const reader = new PrismaUsageReportReader(prisma);
    const query = {
      workspaceId: "workspace-1",
      actorId: null,
      access: "admin" as const,
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
    };
    expect((await reader.report(query)).deliveryCoverage).toEqual([
      { invocationId: "coverage-invocation", coverage: capsule },
    ]);
    expect(
      (
        await reader.report({
          ...query,
          actorId: "other-actor",
          access: "member",
        })
      ).deliveryCoverage,
    ).toEqual([]);
    expect(
      (await reader.report({ ...query, workspaceId: "workspace-2" }))
        .deliveryCoverage,
    ).toEqual([]);
    const reconciliation = new PrismaUsageReconciliation(prisma);
    for (let attempt = 0; attempt < 8; attempt++) {
      const lease = await reconciliation.claim({
        sourceInstance: "failing-source",
        workspaceId: "workspace-1",
        owner: "poller",
        now,
        leaseMs: 60000,
        coveredFrom: now,
      });
      expect(lease).not.toBeNull();
      await reconciliation.fail(lease!, { code: "source_unavailable", now });
      await expect(
        reconciliation.fail(lease!, { code: "source_unavailable", now }),
      ).rejects.toThrow("usage_checkpoint_stale");
      if (attempt < 7)
        await prisma.usageSourceCheckpoint.update({
          where: { sourceInstance: "failing-source" },
          data: { nextAttemptAt: new Date(0) },
        });
    }
    const state = await prisma.usageSourceCheckpoint.findUniqueOrThrow({
      where: { sourceInstance: "failing-source" },
    });
    expect(state.failureCount).toBe(8);
    expect(state.deadLetteredAt).not.toBeNull();
    expect(
      await reconciliation.claim({
        sourceInstance: "failing-source",
        workspaceId: "workspace-1",
        owner: "poller",
        now,
        leaseMs: 60000,
        coveredFrom: now,
      }),
    ).toBeNull();
  });
  it("rejects expired replay before insert and retained tombstones prevent resurrection", async () => {
    await expect(
      store.ingest(fact({ eventId: "expired" }), {
        ...context,
        now: new Date("2026-12-01"),
      }),
    ).rejects.toThrow("source_window_expired");
    expect(
      await prisma.usageSourceFact.count({ where: { eventId: "expired" } }),
    ).toBe(0);
    await prisma.usageCall.delete({ where: { callId: "call-1" } });
    await prisma.usageSourceFact.deleteMany({ where: { callId: "call-1" } });
    await expect(
      store.ingest(fact({ revision: 4, correctionReason: "late" }), context),
    ).rejects.toThrow("usage_report_expired");
    expect(
      await prisma.usageCall.findUnique({ where: { callId: "call-1" } }),
    ).toBeNull();
  });
  it("keeps leases, retries, default timestamps and retention UTC in three session timezones", async () => {
    for (const zone of ["UTC", "Europe/Kyiv", "America/Los_Angeles"]) {
      const configuredUrl = new URL(databaseUrl);
      configuredUrl.searchParams.set(
        "options",
        `-c timezone=${zone} -c statement_timeout=10000`,
      );
      const zoned = createPrismaClient({
        databaseUrl: configuredUrl.toString(),
      });
      try {
        const settings = await zoned.$queryRaw<
          { zone: string; now: Date }[]
        >`SELECT current_setting('TimeZone') AS zone,statement_timestamp() AS now`;
        expect(settings[0]?.zone).toBe("UTC");
        const epoch = await zoned.$queryRaw<
          { epoch: number }[]
        >`SELECT EXTRACT(EPOCH FROM statement_timestamp())::float8 AS epoch`;
        expect(
          Math.abs(settings[0]!.now.getTime() - epoch[0]!.epoch * 1000),
        ).toBeLessThan(1000);
        const wallNow = settings[0]!.now;
        const source = "zone-" + zone.replaceAll("/", "-");
        const identity = {
          ...fact().identity,
          callId: source,
          occurredAt: wallNow.toISOString(),
        };
        const f = fact({ sourceInstance: source, eventId: source, identity });
        const c = {
          ...context,
          now: wallNow,
          replayUntil: new Date(wallNow.getTime() + 86400000),
        };
        const store = new PrismaUsageStore(zoned);
        await store.ingest(f, c);
        const saved = await zoned.usageSourceFact.findUniqueOrThrow({
          where: {
            sourceInstance_eventId_revision: {
              sourceInstance: source,
              eventId: source,
              revision: 1,
            },
          },
        });
        expect(saved.receivedAt.toISOString()).toBe(wallNow.toISOString());
        expect(saved.occurredAt.toISOString()).toBe(wallNow.toISOString());
        await expect(
          store.ingest({ ...f, tokens: { ...f.tokens, total: null } }, c),
        ).rejects.toThrow("usage_hash_conflict");
        const conflict = await zoned.usageIngestionConflict.findFirstOrThrow({
          where: { sourceInstance: source },
        });
        expect(
          Math.abs(conflict.createdAt.getTime() - wallNow.getTime()),
        ).toBeLessThan(5000);
        await zoned.usageUnattributedObservation.create({
          data: {
            sourceInstance: source,
            eventId: "unknown",
            revision: 1,
            hash: "hash",
            payload: { schemaVersion: 1 },
            observedAt: wallNow,
            reason: "unmapped",
          },
        });
        const unattributed =
          await zoned.usageUnattributedObservation.findUniqueOrThrow({
            where: {
              sourceInstance_eventId_revision: {
                sourceInstance: source,
                eventId: "unknown",
                revision: 1,
              },
            },
          });
        expect(
          Math.abs(unattributed.receivedAt.getTime() - wallNow.getTime()),
        ).toBeLessThan(5000);
        expect(
          Math.abs(unattributed.nextResolutionAt.getTime() - wallNow.getTime()),
        ).toBeLessThan(5000);
        await zoned.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('TimeZone',${zone},true)`;
          await tx.$executeRaw`UPDATE "UsageUnattributedObservation" SET "nextResolutionAt"=statement_timestamp() WHERE "sourceInstance"=${source}`;
          const rawEpoch = await tx.$queryRaw<
            { epoch: number; now: number }[]
          >`SELECT EXTRACT(EPOCH FROM "nextResolutionAt")::float8 AS epoch,EXTRACT(EPOCH FROM statement_timestamp())::float8 AS now FROM "UsageUnattributedObservation" WHERE "sourceInstance"=${source}`;
          expect(Math.abs(rawEpoch[0]!.epoch - rawEpoch[0]!.now)).toBeLessThan(
            1,
          );
        });
        const resolution =
          await zoned.usageUnattributedObservation.findUniqueOrThrow({
            where: {
              sourceInstance_eventId_revision: {
                sourceInstance: source,
                eventId: "unknown",
                revision: 1,
              },
            },
          });
        expect(
          Math.abs(resolution.nextResolutionAt.getTime() - wallNow.getTime()),
        ).toBeLessThan(5000);
        const reconciliation = new PrismaUsageReconciliation(zoned);
        const lease = await reconciliation.claim({
          sourceInstance: source,
          workspaceId: "workspace-1",
          owner: "zone-poller",
          now: wallNow,
          leaseMs: 60000,
          coveredFrom: wallNow,
        });
        expect(lease).not.toBeNull();
        const checkpoint = await zoned.usageSourceCheckpoint.findUniqueOrThrow({
          where: { sourceInstance: source },
        });
        expect(
          checkpoint.leaseUntil!.getTime() - wallNow.getTime(),
        ).toBeGreaterThan(55000);
        expect(
          checkpoint.leaseUntil!.getTime() - wallNow.getTime(),
        ).toBeLessThan(65000);
        await reconciliation.commitPage(
          lease!,
          {
            facts: [],
            cursor: "zone-cursor",
            highWaterMark: "zone-water",
            complete: true,
          },
          c,
        );
        expect(
          (
            await zoned.usageSourceCheckpoint.findUniqueOrThrow({
              where: { sourceInstance: source },
            })
          ).asOf?.toISOString(),
        ).toBe(wallNow.toISOString());
        const retryLease = await reconciliation.claim({
          sourceInstance: source,
          workspaceId: "workspace-1",
          owner: "zone-poller",
          now: wallNow,
          leaseMs: 60000,
          coveredFrom: wallNow,
        });
        await reconciliation.fail(retryLease!, {
          code: "source_unavailable",
          now: wallNow,
        });
        const retry = await zoned.usageSourceCheckpoint.findUniqueOrThrow({
          where: { sourceInstance: source },
        });
        expect(
          retry.nextAttemptAt!.getTime() - wallNow.getTime(),
        ).toBeGreaterThan(55000);
        expect(retry.nextAttemptAt!.getTime() - wallNow.getTime()).toBeLessThan(
          65000,
        );
        expect(
          await reconciliation.claim({
            sourceInstance: source,
            workspaceId: "workspace-1",
            owner: "zone-poller",
            now: wallNow,
            leaseMs: 60000,
            coveredFrom: wallNow,
          }),
        ).toBeNull();
        const oldNow = new Date(wallNow.getTime() - 91 * 86400000);
        for (const suffix of ["keep", "expire"]) {
          const old = fact({
            sourceInstance: source,
            eventId: suffix,
            identity: {
              ...identity,
              callId: source + "-" + suffix,
              occurredAt: oldNow.toISOString(),
            },
          });
          await store.ingest(old, { ...c, now: oldNow, replayUntil: wallNow });
        }
        await zoned.$executeRaw`UPDATE "UsageSourceFact" SET "receivedAt"=statement_timestamp()-INTERVAL '90 days'+INTERVAL '30 minutes' WHERE "sourceInstance"=${source} AND "eventId"='keep'`;
        await zoned.$executeRaw`UPDATE "UsageSourceFact" SET "receivedAt"=statement_timestamp()-INTERVAL '90 days'-INTERVAL '30 minutes' WHERE "sourceInstance"=${source} AND "eventId"='expire'`;
        await reconciliation.prune(wallNow);
        expect(
          await zoned.usageSourceFact.count({
            where: { sourceInstance: source, eventId: "keep" },
          }),
        ).toBe(1);
        expect(
          await zoned.usageSourceFact.count({
            where: { sourceInstance: source, eventId: "expire" },
          }),
        ).toBe(0);
      } finally {
        await zoned.$disconnect();
      }
    }
  });
  it("uses the standard runtime grants for a nonowner API writer and deletion trigger", async () => {
    // The suite applies retained migration SQL directly; the normal authority
    // routine also protects Prisma's own ledger, which Prisma CLI creates.
    await prisma.$executeRaw`CREATE TABLE "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL,
      logs TEXT, rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )`;
    const names = [
      "reviewrouter_web",
      "reviewrouter_api",
      "reviewrouter_worker",
      "reviewrouter_codex_effect_authority",
      "reviewrouter_comment_token_custody",
    ];
    const setup = names
      .map(
        (name) =>
          `DO $usage_roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN EXECUTE 'CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'; END IF; END; $usage_roles$;`,
      )
      .join("\n");
    execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
      input: setup,
      stdio: "pipe",
    });
    const roles = [
      { role: "web", username: names[0] },
      { role: "api", username: names[1] },
      { role: "worker", username: names[2] },
      { role: "effect-authority", username: names[3] },
      { role: "comment-token-custody", username: names[4] },
    ];
    // Execute the actual release authority's ACL implementation, not a mock grant list.
    const grantScript = `import {runtimeGrantStatements} from './scripts/run-codex-rotating-release-migration.mjs';process.stdout.write(runtimeGrantStatements({roles:${JSON.stringify(roles)}},undefined,{skipDatabaseAcl:true}));`;
    const grants = execFileSync(
      "node",
      ["--import", "tsx", "--input-type=module", "-e", grantScript],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
      input: grants,
      stdio: "pipe",
    });
    await prisma.workspace.create({
      data: {
        id: "runtime-role-workspace",
        slug: "runtime-role-workspace",
        name: "Runtime role",
      },
    });
    const runtimeUrl = new URL(databaseUrl);
    runtimeUrl.username = "reviewrouter_api";
    runtimeUrl.password = "";
    const runtime = createPrismaClient({ databaseUrl: runtimeUrl.toString() });
    try {
      const privileges = await runtime.$queryRaw<
        {
          role: string;
          superuser: boolean;
          owns: boolean;
          canWrite: boolean;
          canTrigger: boolean;
        }[]
      >`SELECT current_user AS role,role.rolsuper AS superuser,relation.relowner=role.oid AS owns,has_table_privilege(current_user,'public."UsageCall"','SELECT,INSERT,UPDATE,DELETE') AS "canWrite",has_table_privilege(current_user,'public."Workspace"','TRIGGER') AS "canTrigger" FROM pg_roles role,pg_class relation WHERE role.rolname=current_user AND relation.oid='public."UsageCall"'::regclass`;
      expect(privileges[0]).toEqual({
        role: "reviewrouter_api",
        superuser: false,
        owns: false,
        canWrite: true,
        canTrigger: false,
      });
      const f = fact({
        sourceInstance: "runtime-role",
        eventId: "runtime-role",
        identity: {
          ...fact().identity,
          workspaceId: "runtime-role-workspace",
          callId: "runtime-role-call",
        },
      });
      await new PrismaUsageStore(runtime).ingest(f, {
        ...context,
        workspaceId: "runtime-role-workspace",
      });
      expect(
        await runtime.usageCall.count({
          where: { workspaceId: "runtime-role-workspace" },
        }),
      ).toBe(1);
      await runtime.providerUsageGrant.create({
        data: {
          id: "runtime-role-grant",
          tokenHash: "runtime-role-hash",
          workspaceId: "runtime-role-workspace",
          invocationId: "invocation-1",
          repositoryId: "123",
          runId: "456",
          runAttempt: 1,
          authorizationId: "auth-1",
          producerDigest: "a".repeat(64),
          workflowIdentity: "workflow",
          jobIdentity: "job",
          publicKey: "test-key",
          issuedAt: now,
          expiresAt: new Date("2026-10-28"),
        },
      });
      await runtime.workspace.update({
        where: { id: "runtime-role-workspace" },
        data: { deletionState: "delete_pending" },
      });
      expect(
        await runtime.usageCall.count({
          where: { workspaceId: "runtime-role-workspace" },
        }),
      ).toBe(0);
      expect(
        (
          await runtime.providerUsageGrant.findUniqueOrThrow({
            where: { id: "runtime-role-grant" },
          })
        ).revokedAt,
      ).not.toBeNull();
    } finally {
      await runtime.$disconnect();
    }
  });
  it("matches full report accounting across partial families, original attempts, dimensions and actor scope", async () => {
    const scope = "sql-report-parity";
    const a = reportProjection(
      scope,
      "a",
      { provider: "A", requestedModel: "X" },
      measured(8, "0.01"),
    );
    const b = reportProjection(
      scope,
      "b",
      { provider: "B", requestedModel: "Y", actorId: "actor-2" },
      { ...measured(12, "0.02"), completeness: "partial" },
    );
    const c = reportProjection(
      scope,
      "c",
      { provider: "A", requestedModel: "X" },
      measured(5, "0.03"),
    );
    const d = reportProjection(
      scope,
      "d",
      {
        provider: "B",
        requestedModel: "Y",
        actorId: "actor-2",
        route: "direct",
      },
      measured(7, "0.04"),
    );
    const summary = reportProjection(
      scope,
      "s",
      { provider: "A", requestedModel: "X", granularity: "turn" },
      {
        ...measured(100),
        childCallIds: [a.identity.callId, b.identity.callId],
      },
    );
    const completeSummary = reportProjection(
      scope,
      "t",
      { granularity: "turn" },
      {
        ...measured(999),
        childCallIds: [c.identity.callId, d.identity.callId],
      },
    );
    const unknown = reportProjection(scope, "u", {
      provider: "U",
      requestedModel: null,
    });
    unknown.lifecycle = fact({
      authority: "lifecycle",
      identity: unknown.identity,
    });
    unknown.usage = null;
    const prepared = reportProjection(scope, "p", {
      provider: "P",
      runId: `${scope}-prepared`,
    });
    prepared.lifecycle = fact({
      authority: "lifecycle",
      identity: prepared.identity,
      state: "prepared",
      dispatchEffect: "not_dispatched",
    });
    prepared.usage = null;
    const nondispatched = reportProjection(
      scope,
      "n",
      { provider: "N", runId: `${scope}-not-dispatched` },
      { ...measured(900), state: "failed", dispatchEffect: "not_dispatched" },
    );
    const unbounded = reportProjection(scope, "v", {
      provider: "V",
      granularity: "turn",
      runId: `${scope}-unbounded`,
    });
    const zero = reportProjection(
      scope,
      "z",
      { provider: "A", requestedModel: "zero", purpose: "diagnostic" },
      {
        ...measured(0, "0"),
        cost: { ...fact().cost!, currency: "EUR", amount: "0" },
      },
    );
    const rows = [
      a,
      b,
      c,
      d,
      nondispatched,
      prepared,
      summary,
      completeSummary,
      unknown,
      unbounded,
      zero,
    ];
    await seedReport(scope, [
      ...rows,
      reportProjection(
        scope,
        "out-of-period",
        { occurredAt: "2026-09-30T23:59:59.999Z" },
        measured(600),
      ),
    ]);
    await seedReport(`${scope}-foreign`, [
      reportProjection(`${scope}-foreign`, "foreign", {}, measured(500)),
    ]);
    const reader = new PrismaUsageReportReader(prisma);
    const query = { ...reportQuery(scope), limit: 2 };
    const report = await reader.report(query);
    expect(report).toEqual({
      ...buildUsagePeriodReport(rows, query),
      unattributedCount: 0,
    });
    // Independent arithmetic: the partial family contributes 100; the complete
    // family contributes 5 + 7; unknown/prepared observations add no known tokens.
    expect(report.totals).toMatchObject({
      tokens: { total: 112 },
      providerAttempts: 6,
      logicalRuns: 4,
      reportedSummaries: 1,
      diagnosticCount: 1,
      unknownCount: 2,
      unknownTotalTokenCount: 2,
      unknownTokenValues: 12,
      unknownCostCount: 2,
    });
    expect(report.totals.costs).toEqual([
      { currency: "USD", basis: "source_reported", amount: "0.17" },
      { currency: "EUR", basis: "source_reported", amount: "0" },
    ]);
    expect(report.partialChildCount).toBe(2);
    expect(report.unboundedSummaryCount).toBe(1);
    // The first legacy bucket contains c, d, z and the selected summary. Missing
    // usage falls back to its requested provider, so U/P form separate buckets.
    expect(report.groups[0]!.totals).toMatchObject({
      providerAttempts: 3,
      logicalRuns: 1,
    });
    const filteredQuery = { ...query, provider: "B", model: "Y" };
    const filtered = await reader.report(filteredQuery);
    expect(filtered).toEqual({
      ...buildUsagePeriodReport(rows, filteredQuery),
      unattributedCount: 0,
    });
    expect(filtered.totals).toMatchObject({
      tokens: { total: 7 },
      providerAttempts: 2,
    });
    expect(filtered.partialChildCount).toBe(1);
    expect(filtered.overview.facets).toEqual(report.overview.facets);
    const memberQuery = {
      ...query,
      access: "member" as const,
      actorId: "actor-2",
    };
    const member = await reader.report(memberQuery);
    expect(member).toEqual(buildUsagePeriodReport([b, d], memberQuery));
    expect(member.totals).toMatchObject({
      tokens: { total: 19 },
      providerAttempts: 2,
      partialCount: 1,
    });
    expect(member.overview.facets.providers).toEqual(["B"]);
    const familyOwnerQuery = { ...memberQuery, actorId: "actor-1" };
    const familyOwner = await reader.report(familyOwnerQuery);
    expect(familyOwner).toEqual(
      buildUsagePeriodReport(
        rows.filter((p) => p.identity.actorId === "actor-1"),
        familyOwnerQuery,
      ),
    );
    // A foreign actor's complete child cannot complete this member's family.
    expect(familyOwner.totals.tokens.total).toBe(1099);
    expect(familyOwner.totals.reportedSummaries).toBe(2);
  });

  it("rejects globally overlapping missing-child manifests even when their models are filtered out", async () => {
    const scope = "sql-report-conflict";
    await seedReport(scope, [
      reportProjection(scope, "visible", { provider: "visible" }),
      reportProjection(
        scope,
        "summary-a",
        { granularity: "turn", provider: "hidden-a" },
        { childCallIds: ["missing-child"] },
      ),
      reportProjection(
        scope,
        "summary-b",
        { granularity: "turn", provider: "hidden-b" },
        { childCallIds: ["missing-child"] },
      ),
    ]);
    await expect(
      new PrismaUsageReportReader(prisma).report({
        ...reportQuery(scope),
        provider: "visible",
      }),
    ).rejects.toThrow("usage_authority_conflict");
  });

  it("uses JS UTF16 ordering for independent call/run pages and absent cursors", async () => {
    const scope = "sql-report-order";
    const suffixes = ["z", "\u{10000}", "\uE000"];
    await seedReport(
      scope,
      suffixes.map((id) =>
        reportProjection(scope, id, { runId: `${scope}-${id}` }, measured(1)),
      ),
    );
    const reader = new PrismaUsageReportReader(prisma);
    const query = { ...reportQuery(scope), limit: 1 };
    let after: string | undefined;
    let runAfter: string | undefined;
    for (const suffix of suffixes) {
      const page = await reader.report({
        ...query,
        ...(after ? { after } : {}),
        ...(runAfter ? { runAfter } : {}),
      });
      expect(page.rows.map((p) => p.identity.callId)).toEqual([
        `${scope}-${suffix}`,
      ]);
      expect(page.overview.runs.map((p) => p.runId)).toEqual([
        `${scope}-${suffix}`,
      ]);
      expect(page.totals.tokens.total).toBe(3);
      after = page.nextCursor ?? undefined;
      runAfter = page.overview.nextRunCursor ?? undefined;
    }
    expect(after).toBeUndefined();
    expect(runAfter).toBeUndefined();
    const absent = `${scope}-\u{10001}`;
    const page = await reader.report({
      ...query,
      after: absent,
      runAfter: absent,
    });
    expect(page.rows[0]!.identity.callId).toBe(`${scope}-\uE000`);
    expect(page.overview.runs[0]!.runId).toBe(`${scope}-\uE000`);
    const callOnly = await reader.report({ ...query, after: `${scope}-z` });
    expect(callOnly.rows[0]!.identity.callId).toBe(`${scope}-\u{10000}`);
    expect(callOnly.overview.runs[0]!.runId).toBe(`${scope}-z`);
  });

  it("retains raw UTC day spelling, endpoint precision, first-seen groups and exact money", async () => {
    const scope = "sql-report-raw";
    const rows = [
      reportProjection(
        scope,
        "a",
        { provider: "Z", occurredAt: "2026-10-20T24:00:00Z" },
        {
          ...measured(null, "9007199254740991.000000000001"),
          actualProvider: "Z",
        },
      ),
      reportProjection(
        scope,
        "b",
        { provider: "A", occurredAt: "2026-10-21T00:00:00.0Z" },
        {
          ...measured(0),
          actualProvider: "A",
          cost: { ...fact().cost!, currency: "EUR", amount: "0" },
        },
      ),
      reportProjection(
        scope,
        "c",
        { provider: "C", occurredAt: "2026-10-21T00:00:00.000Z" },
        { ...measured(5, "0.000000000001"), actualProvider: "C" },
      ),
      reportProjection(
        scope,
        "d",
        { provider: "C", occurredAt: "2026-10-21T00:00:00Z" },
        { ...measured(7, "0"), actualProvider: "C" },
      ),
    ];
    await seedReport(scope, rows);
    const query = reportQuery(scope);
    const report = await new PrismaUsageReportReader(prisma).report(query);
    expect(report).toEqual({
      ...buildUsagePeriodReport(rows, query),
      unattributedCount: 0,
    });
    expect(report.totals.tokens.total).toBe(12);
    expect(report.totals.costs).toEqual([
      {
        currency: "USD",
        basis: "source_reported",
        amount: "9007199254740991.000000000002",
      },
      { currency: "EUR", basis: "source_reported", amount: "0" },
    ]);
    expect(
      report.groups.map((g) => [g.provider, g.day, g.totals.tokens.total]),
    ).toEqual([
      ["Z", "2026-10-20", null],
      ["A", "2026-10-21", 0],
      ["C", "2026-10-21", 12],
    ]);
    expect(report.overview.runs[0]).toMatchObject({
      firstOccurredAt: "2026-10-20T24:00:00Z",
      lastOccurredAt: "2026-10-21T00:00:00Z",
    });
    const overflowScope = "sql-report-overflow";
    await seedReport(overflowScope, [
      reportProjection(
        overflowScope,
        "a",
        {},
        measured(Number.MAX_SAFE_INTEGER),
      ),
      reportProjection(overflowScope, "b", {}, measured(1)),
    ]);
    await expect(
      new PrismaUsageReportReader(prisma).report(reportQuery(overflowScope)),
    ).rejects.toThrow("usage_report_overflow");
  });

  it("keeps family selection, totals and hydrated rows on one real RepeatableRead snapshot", async () => {
    const scope = "sql-report-snapshot";
    const a = reportProjection(scope, "a", {}, measured(8));
    const b = reportProjection(
      scope,
      "b",
      {},
      { ...measured(12), completeness: "partial" },
    );
    const summary = reportProjection(
      scope,
      "s",
      { granularity: "turn" },
      {
        ...measured(100),
        childCallIds: [a.identity.callId, b.identity.callId],
      },
    );
    await seedReport(scope, [a, b, summary]);
    const writer = createPrismaClient({ databaseUrl });
    let corrected = false;
    const observed = new Proxy(prisma, {
      get(target, key) {
        if (key === "$transaction")
          return async <T>(
            run: (tx: Prisma.TransactionClient) => Promise<T>,
            options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
          ) => {
            expect(options?.isolationLevel).toBe("RepeatableRead");
            return target.$transaction(
              async (tx) =>
                run(
                  new Proxy(tx, {
                    get(transaction, member) {
                      if (member === "$queryRaw")
                        return async (
                          sql: Prisma.Sql | TemplateStringsArray,
                          ...values: unknown[]
                        ) => {
                          const result = await transaction.$queryRaw(
                            sql,
                            ...values,
                          );
                          const text = Array.isArray(sql)
                            ? sql.join("")
                            : (sql as Prisma.Sql).text;
                          if (
                            !corrected &&
                            text.includes("usage-report:families")
                          ) {
                            corrected = true;
                            await writer.usageCall.update({
                              where: { callId: b.identity.callId },
                              data: {
                                projection: {
                                  ...b,
                                  usage: {
                                    ...b.usage!,
                                    completeness: "complete",
                                  },
                                } as unknown as Prisma.InputJsonValue,
                              },
                            });
                          }
                          return result;
                        };
                      const value = Reflect.get(transaction, member);
                      return typeof value === "function"
                        ? value.bind(transaction)
                        : value;
                    },
                  }),
                ),
              options,
            );
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      const first = await new PrismaUsageReportReader(observed).report(
        reportQuery(scope),
      );
      expect(corrected).toBe(true);
      expect(first.totals.tokens.total).toBe(100);
      expect(first.rows.map((p) => p.identity.callId)).toEqual([
        summary.identity.callId,
      ]);
      const next = await new PrismaUsageReportReader(prisma).report(
        reportQuery(scope),
      );
      expect(next.totals.tokens.total).toBe(20);
      expect(next.rows.map((p) => p.identity.callId)).toEqual([
        a.identity.callId,
        b.identity.callId,
      ]);
    } finally {
      await writer.$disconnect();
    }
  });

  it("retains operator authority and active-workspace scope through the shared reader", async () => {
    const scope = "sql-report-operator";
    const actorId = `${scope}-admin`;
    await prisma.user.create({ data: { id: actorId } });
    await seedReport(scope, [
      reportProjection(scope, "a", { bindingId: scope }, measured(11)),
    ]);
    await seedReport(`${scope}-other`, [
      reportProjection(
        `${scope}-other`,
        "b",
        { bindingId: scope },
        measured(13),
      ),
    ]);
    await seedReport(
      `${scope}-deleted`,
      [
        reportProjection(
          `${scope}-deleted`,
          "c",
          { bindingId: scope },
          measured(999),
        ),
      ],
      "delete_pending",
    );
    await prisma.workspaceMember.create({
      data: { workspaceId: scope, userId: actorId, role: "admin" },
    });
    const reader = new PrismaOperatorUsageReportReader(prisma, scope);
    const query = {
      operatorWorkspaceId: scope,
      actorId,
      bindingId: scope,
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
    };
    expect((await reader.report(query)).totals.tokens.total).toBe(24);
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: scope, userId: actorId },
    });
    await expect(reader.report(query)).rejects.toThrow("usage_access_denied");
    await prisma.workspaceMember.create({
      data: { workspaceId: scope, userId: actorId, role: "owner" },
    });
    await prisma.workspace.update({
      where: { id: scope },
      data: { deletionState: "delete_pending" },
    });
    await expect(reader.report(query)).rejects.toThrow("usage_access_denied");
  });

  it.runIf(process.env.USAGE_SQL_QUALIFICATION === "1")(
    "qualifies bounded report reads and actual scan plans",
    () => qualifyUsageSqlReport(prisma),
    180000,
  );

  it("deletes workspace projections, disables checkpoint and denies new ingest", async () => {
    await prisma.workspace.update({
      where: { id: "workspace-1" },
      data: { deletionState: "delete_pending" },
    });
    expect(
      await prisma.usageCall.count({ where: { workspaceId: "workspace-1" } }),
    ).toBe(0);
    expect(
      (
        await prisma.providerUsageGrant.findUniqueOrThrow({
          where: { id: "coverage-grant" },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      (
        await prisma.usageSourceCheckpoint.findUnique({
          where: { sourceInstance: "page-source" },
        })
      )?.disabledAt,
    ).not.toBeNull();
    await expect(
      store.ingest(fact({ eventId: "after-delete" }), context),
    ).rejects.toThrow("usage_scope_deleted");
  });
});
