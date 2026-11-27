import { webhookFencePostgres, assertWebhookFenceTestDatabase } from "../../../../scripts/webhook-fencing/postgres-fixture";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { PrismaRepositoryWebhookHandler } from "./prisma-repository-webhook-handler";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";

const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("fenced repository webhook on isolated PostgreSQL", () => {
  const schema = `webhook_repo_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const owner = "a".repeat(64);
  const envelope = (deliveryId: string) => ({
    deliveryId,
    eventName: "repository" as const,
    payloadHash: "hash",
    payload: {
      action: "deleted",
      installation: {
        id: 123,
        account: { login: "test", type: "Organization" as const },
        repository_selection: "all" as const,
      },
      repository: {
        id: 456,
        owner: { login: "test" },
        name: "repo",
        full_name: "test/repo",
        archived: false,
      },
    },
  });
  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      "CREATE TYPE \"WebhookDeliveryStatus\" AS ENUM ('received','processing','processed','failed')",
    );
    await pool.query(
      `CREATE TABLE "GitHubWebhookDelivery" (id TEXT PRIMARY KEY DEFAULT 'synthetic-' || md5(random()::text), "deliveryId" TEXT UNIQUE NOT NULL, "eventName" TEXT NOT NULL, action TEXT, "installationId" BIGINT, "payloadHash" TEXT, "normalizedEvent" JSONB, status "WebhookDeliveryStatus" NOT NULL DEFAULT 'processing', "errorSummary" TEXT, "processedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    await pool.query(
      await readFile(
        new URL(
          "../../../../packages/platform/db/prisma/migrations/000165_webhook_effect_fence/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pool.query(
      'CREATE TABLE "GitHubInstallation" (id TEXT PRIMARY KEY, "githubInstallationId" BIGINT UNIQUE NOT NULL)',
    );
    await pool.query(
      'CREATE TABLE "RepositoryConnection" (id TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"installationId" TEXT,"githubRepositoryId" BIGINT UNIQUE NOT NULL,"defaultBranch" TEXT NOT NULL,"fullName" TEXT NOT NULL,"lastSyncedAt" TIMESTAMP(3),selected BOOLEAN NOT NULL,"scmRepositoryIdentityId" TEXT,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    await pool.query("INSERT INTO \"GitHubInstallation\" VALUES ('inst',123)");
    await pool.query(
      'INSERT INTO "RepositoryConnection" (id,"workspaceId","installationId","githubRepositoryId","defaultBranch","fullName",selected) VALUES (\'repo\',\'workspace\',\'inst\',456,\'main\',\'test/repo\',true)',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("commits repository mutation and delivery completion together", async () => {
    const e = envelope("repo-success");
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: e.payloadHash,
      },
      owner,
      10000,
      "d".repeat(64),
    );
    await new PrismaRepositoryWebhookHandler(
      prisma,
    ).handleFencedGitHubRepositoryWebhook(e, claim);
    expect(
      (await pool.query('SELECT selected FROM "RepositoryConnection"')).rows[0]
        .selected,
    ).toBe(false);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processed");
  });
  it("rolls back repository mutation when completion fails", async () => {
    await pool.query('UPDATE "RepositoryConnection" SET selected=true');
    const e = envelope("repo-rollback");
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: e.payloadHash,
      },
      owner,
      10000,
      "d".repeat(64),
    );
    await pool.query(
      "ALTER TABLE \"GitHubWebhookDelivery\" ADD CONSTRAINT synthetic_repo_failure CHECK (\"deliveryId\" <> 'repo-rollback' OR status <> 'processed')",
    );
    await expect(
      new PrismaRepositoryWebhookHandler(
        prisma,
      ).handleFencedGitHubRepositoryWebhook(e, claim),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT selected FROM "RepositoryConnection"')).rows[0]
        .selected,
    ).toBe(true);
  });
  it("does not mutate repository with a stale generation", async () => {
    const e = envelope("repo-stale");
    const previous = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: e.payloadHash,
        normalizedEvent: {
          type: "github.repository",
          version: 1,
          installationId: String(e.payload.installation.id),
          repositoryId: String(e.payload.repository.id),
          repositoryFullName: e.payload.repository.full_name,
          action: e.payload.action,
          defaultBranch: null,
          visibility: "public",
          archived: e.payload.repository.archived,
        },
      },
      owner,
      10000,
      "d".repeat(64),
    );
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    expect(
      await reclaimWebhookFence(prisma, previous, "b".repeat(64), 10000),
    ).not.toBeNull();
    await expect(
      new PrismaRepositoryWebhookHandler(
        prisma,
      ).handleFencedGitHubRepositoryWebhook(e, previous),
    ).rejects.toThrow("webhook_fence_stale");
    expect(
      (await pool.query('SELECT selected FROM "RepositoryConnection"')).rows[0]
        .selected,
    ).toBe(true);
  });
  it("does not use stale authority when a scope change and takeover race", async () => {
    const e = envelope("repo-scope-race");
    const previous = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: e.payloadHash,
        normalizedEvent: {
          type: "github.repository",
          version: 1,
          installationId: String(e.payload.installation.id),
          repositoryId: String(e.payload.repository.id),
          repositoryFullName: e.payload.repository.full_name,
          action: e.payload.action,
          defaultBranch: null,
          visibility: "public",
          archived: e.payload.repository.archived,
        },
      },
      owner,
      10000,
      "d".repeat(64),
    );
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authorityWriter = prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "exclusive" }]);
        await tx.$executeRaw(
          Prisma.sql`UPDATE "RepositoryConnection" SET "fullName" = 'test/new' WHERE id = 'repo'`,
        );
        entered();
        await gate;
      },
      { isolationLevel: "ReadCommitted" },
    );
    await enteredPromise;
    const oldHandler = new PrismaRepositoryWebhookHandler(prisma)
      .handleFencedGitHubRepositoryWebhook(e, previous)
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      let waiting = false;
      for (let i = 0; i < 80 && !waiting; i++) {
        waiting =
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            )
          ).rows[0].n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      await pool.query(
        'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
        [e.deliveryId],
      );
      expect(
        await reclaimWebhookFence(prisma, previous, "c".repeat(64), 10000),
      ).not.toBeNull();
    } finally {
      release();
    }
    await authorityWriter;
    expect(await oldHandler).toBeInstanceOf(Error);
    expect(
      (
        await pool.query(
          'SELECT selected,"fullName" FROM "RepositoryConnection"',
        )
      ).rows[0],
    ).toEqual({ selected: true, fullName: "test/new" });
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processing");
  });
  it("preserves ordinary repository removal", async () => {
    await new PrismaRepositoryWebhookHandler(
      prisma,
    ).handleGitHubRepositoryWebhook(envelope("ordinary-writer"));
    expect(
      (
        await pool.query(
          "SELECT selected FROM \"RepositoryConnection\" WHERE id='repo'",
        )
      ).rows[0].selected,
    ).toBe(false);
  });
});
