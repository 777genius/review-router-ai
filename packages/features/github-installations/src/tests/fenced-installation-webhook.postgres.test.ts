import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginFencedWebhookDelivery } from "../infrastructure/prisma/webhook-effect-fence";
import { handleFencedInstallationWebhook } from "../infrastructure/prisma/fenced-installation-webhook";

const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("fenced installation webhook on isolated PostgreSQL", () => {
  const schema = `webhook_install_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const clock = { now: () => new Date("2026-01-01") };
  const envelope = (deliveryId: string) => ({
    deliveryId,
    eventName: "installation_repositories" as const,
    payloadHash: "hash",
    payload: {
      action: "added",
      repositories_added: [],
      repositories_removed: [],
      installation: {
        id: 42,
        account: { login: "new-team", type: "Organization" },
        repository_selection: "selected",
      },
    },
  });
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
      CREATE TABLE "RepositoryPermissionCache" ("githubInstallationId" BIGINT);
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
  async function run(id: string) {
    const e = envelope(id);
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: id,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "42",
        payloadHash: e.payloadHash,
      },
      "a".repeat(64),
      10000,
    );
    return { e, claim };
  }
  it("commits installation, invalidation, outbox and terminal status", async () => {
    const { e, claim } = await run("success");
    await handleFencedInstallationWebhook(prisma, e, claim, clock);
    expect(
      (
        await pool.query(
          'SELECT "accountLogin" FROM "GitHubInstallation" WHERE id=\'i\'',
        )
      ).rows[0].accountLogin,
    ).toBe("new-team");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "RepositoryPermissionCache"',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=\'success\'',
        )
      ).rows[0].status,
    ).toBe("processed");
  });
  it("rolls back installation and outbox if terminal transition fails", async () => {
    await pool.query(
      'UPDATE "GitHubInstallation" SET "accountLogin"=\'before\'',
    );
    await pool.query(
      "ALTER TABLE \"GitHubWebhookDelivery\" ADD CONSTRAINT synthetic_fail CHECK (\"deliveryId\" <> 'rollback' OR status <> 'processed')",
    );
    const { e, claim } = await run("rollback");
    await expect(
      handleFencedInstallationWebhook(prisma, e, claim, clock),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT "accountLogin" FROM "GitHubInstallation" WHERE id=\'i\'',
        )
      ).rows[0].accountLogin,
    ).toBe("before");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "OutboxEvent" WHERE "idempotencyKey"=\'installation:42:sync:rollback\'',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("rejects a stale generation before changing installation or outbox", async () => {
    const { e, claim } = await run("stale");
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET generation = generation + 1 WHERE "deliveryId" = $1',
      [e.deliveryId],
    );
    await expect(
      handleFencedInstallationWebhook(prisma, e, claim, clock),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT "accountLogin" FROM "GitHubInstallation" WHERE id=\'i\'',
        )
      ).rows[0].accountLogin,
    ).toBe("before");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "OutboxEvent" WHERE "idempotencyKey"=\'installation:42:sync:stale\'',
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
