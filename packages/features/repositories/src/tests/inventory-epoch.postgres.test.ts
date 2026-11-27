import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaRepositoryConnectionRepository } from "../infrastructure/prisma/prisma-repository-connection-repository";

const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("repository inventory epoch on isolated PostgreSQL", () => {
  const schema = `inventory_epoch_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  beforeAll(async () => {
    if (
      !socket?.startsWith("/") ||
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
        "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('received','processing','processed','failed');
      CREATE TYPE "GitHubInstallationStatus" AS ENUM ('pending','active','suspended','removed','permission_error','sync_error');
      CREATE TYPE "WorkspaceDeletionState" AS ENUM ('active','delete_pending','deleted');
      CREATE TYPE "OutboxEventStatus" AS ENUM ('pending','processing','retry_wait','processed','dead_letter');
      CREATE TABLE "GitHubWebhookDelivery" (id TEXT PRIMARY KEY DEFAULT 'synthetic-' || md5(random()::text), "deliveryId" TEXT UNIQUE NOT NULL, "eventName" TEXT NOT NULL, action TEXT, "installationId" BIGINT, "payloadHash" TEXT, "normalizedEvent" JSONB, status "WebhookDeliveryStatus" NOT NULL DEFAULT 'processing', "errorSummary" TEXT, "processedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "Workspace" (id TEXT PRIMARY KEY, slug TEXT UNIQUE, name TEXT, "reviewDraftPullRequests" BOOLEAN DEFAULT true, "providerManagementAdminOnly" BOOLEAN DEFAULT false, "deletionState" "WorkspaceDeletionState" DEFAULT 'active', "deletionRevision" INT DEFAULT 1, "deletionTombstonedAt" TIMESTAMP(3), "personalOwnerUserId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "GitHubInstallation" (id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "githubInstallationId" BIGINT UNIQUE NOT NULL, "accountLogin" TEXT NOT NULL, "accountType" TEXT NOT NULL, "accountAvatarUrl" TEXT, "repositorySelection" TEXT NOT NULL, "inventoryGeneration" BIGINT DEFAULT 0, status "GitHubInstallationStatus" DEFAULT 'active', "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TYPE "WorkspaceRole" AS ENUM ('owner','admin','member');
      CREATE TABLE "User" (id TEXT PRIMARY KEY, "githubUserId" BIGINT UNIQUE, "githubLogin" TEXT, "primaryEmail" TEXT, "avatarUrl" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "WorkspaceMember" (id TEXT PRIMARY KEY, "workspaceId" TEXT, "userId" TEXT, "githubLogin" TEXT, role "WorkspaceRole", "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, UNIQUE("workspaceId","userId"), UNIQUE("workspaceId","githubLogin"));
      CREATE TABLE "RepositoryPermissionCache" ("githubInstallationId" BIGINT);
      CREATE TABLE "RepositoryConnection" (id TEXT PRIMARY KEY, "workspaceId" TEXT, "installationId" TEXT, "scmRepositoryIdentityId" TEXT, selected BOOLEAN, "inventoryGeneration" BIGINT DEFAULT 0, "lastSyncedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "RepositoryConnection" (id,"workspaceId","installationId",selected) VALUES ('r','w','i',true);
      CREATE TABLE "OutboxEvent" (id TEXT PRIMARY KEY, type TEXT NOT NULL, version INT NOT NULL, "idempotencyKey" TEXT UNIQUE NOT NULL, "workspaceId" TEXT, "repositoryId" TEXT, "aggregateId" TEXT, payload JSONB NOT NULL, status "OutboxEventStatus" DEFAULT 'pending', attempts INT DEFAULT 0, "maxAttempts" INT DEFAULT 5, "nextAttemptAt" TIMESTAMP(3), "claimId" TEXT, "claimVersion" BIGINT, "claimOwnerHash" TEXT, "claimUntil" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "deadLetteredAt" TIMESTAMP(3), "lastErrorCode" TEXT, "safeLastErrorSummary" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (id,slug,name) VALUES ('w','synthetic','old-team');
      INSERT INTO "GitHubInstallation" (id,"workspaceId","githubInstallationId","accountLogin","accountType","repositorySelection") VALUES ('i','w',42,'old-team','Organization','selected');
      INSERT INTO "RepositoryPermissionCache" VALUES (42);`);
    for (const migration of [
      "000165_webhook_effect_fence",
      "000166_current_scope_epoch",
    ])
      await pool.query(
        await readFile(
          new URL(
            `../../../../platform/db/prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("commits inventory removal and epoch together", async () => {
    const store = new PrismaRepositoryConnectionRepository(prisma);
    const result = await store.syncInstallationRepositories({
      githubInstallationId: "42",
      repositories: [],
      syncedAt: new Date("2026-01-01"),
      inventoryGeneration: 1n,
    });
    expect(result.unselected).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT selected FROM \"RepositoryConnection\" WHERE id='r'",
        )
      ).rows[0].selected,
    ).toBe(false);
    expect(
      (
        await pool.query(
          'SELECT "inventoryGeneration" FROM "GitHubInstallation" WHERE id=\'i\'',
        )
      ).rows[0].inventoryGeneration,
    ).toBe("1");
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(1);
  });
  it("rolls inventory removals back with the epoch on later failure", async () => {
    await pool.query(
      'UPDATE "RepositoryConnection" SET selected=true, "inventoryGeneration"=0',
    );
    await pool.query(
      'ALTER TABLE "GitHubInstallation" ADD CONSTRAINT synthetic_inventory_failure CHECK ("inventoryGeneration" < 2)',
    );
    const before = (
      await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"')
    ).rows[0].n;
    await expect(
      new PrismaRepositoryConnectionRepository(
        prisma,
      ).syncInstallationRepositories({
        githubInstallationId: "42",
        repositories: [],
        syncedAt: new Date("2026-01-02"),
        inventoryGeneration: 2n,
      }),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          "SELECT selected FROM \"RepositoryConnection\" WHERE id='r'",
        )
      ).rows[0].selected,
    ).toBe(true);
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(before);
  });
});
