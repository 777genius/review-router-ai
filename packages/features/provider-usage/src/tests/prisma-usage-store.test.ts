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
import { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { fact } from "./fixture";
import {
  PrismaUsageStore,
  PrismaUsageReportReader,
} from "../infrastructure/prisma-usage-store";
import { PrismaUsageReconciliation } from "../infrastructure/prisma-usage-reconciliation";
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
