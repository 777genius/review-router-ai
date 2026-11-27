import { webhookFencePostgres, assertWebhookFenceTestDatabase } from "../../../../../scripts/webhook-fencing/postgres-fixture";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginFencedWebhookDelivery } from "../infrastructure/prisma/webhook-effect-fence";
import { handleFencedInstallationWebhook } from "../infrastructure/prisma/fenced-installation-webhook";
import { PrismaGitHubInstallationRepository } from "../infrastructure/prisma/prisma-github-installation-repository";
import { PrismaInstallationWorkspaceOwnerGrant } from "../infrastructure/prisma/prisma-installation-workspace-owner-grant";

const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("fenced installation webhook on isolated PostgreSQL", () => {
  const schema = `webhook_install_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
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
    await assertWebhookFenceTestDatabase(pool);
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
      CREATE TABLE "RepositoryConnection" (id TEXT PRIMARY KEY, "workspaceId" TEXT, "installationId" TEXT, "scmRepositoryIdentityId" TEXT, selected BOOLEAN, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "RepositoryConnection" (id,"workspaceId","installationId",selected) VALUES ('r','w','i',true);
      CREATE TABLE "OutboxEvent" (id TEXT PRIMARY KEY, type TEXT NOT NULL, version INT NOT NULL, "idempotencyKey" TEXT UNIQUE NOT NULL, "workspaceId" TEXT, "repositoryId" TEXT, "aggregateId" TEXT, payload JSONB NOT NULL, status "OutboxEventStatus" DEFAULT 'pending', attempts INT DEFAULT 0, "maxAttempts" INT DEFAULT 5, "nextAttemptAt" TIMESTAMP(3), "claimId" TEXT, "claimVersion" BIGINT, "claimOwnerHash" TEXT, "claimUntil" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "deadLetteredAt" TIMESTAMP(3), "lastErrorCode" TEXT, "safeLastErrorSummary" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (id,slug,name) VALUES ('w','synthetic','old-team');
      INSERT INTO "GitHubInstallation" (id,"workspaceId","githubInstallationId","accountLogin","accountType","repositorySelection") VALUES ('i','w',42,'old-team','Organization','selected');
      INSERT INTO "RepositoryPermissionCache" VALUES (42);`);
    for (const migration of [
      "000165_webhook_effect_fence",
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
      "d".repeat(64),
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
  it("preserves ordinary installation metadata updates", async () => {
    await new PrismaGitHubInstallationRepository(prisma).upsertInstallation({
      githubInstallationId: "42",
      accountLogin: "writer-team",
      accountType: "Organization",
      accountAvatarUrl: null,
      repositorySelection: "selected",
      status: "active",
    });
    expect(
      (
        await pool.query(
          'SELECT "accountLogin" FROM "GitHubInstallation" WHERE id=\'i\'',
        )
      ).rows[0].accountLogin,
    ).toBe("writer-team");
  });
  it("reads fresh authority after waiting for the real installation writer", async () => {
    await pool.query(
      `CREATE FUNCTION synthetic_hold_writer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87892144); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER synthetic_hold BEFORE UPDATE ON "GitHubInstallation" FOR EACH ROW EXECUTE FUNCTION synthetic_hold_writer()`,
    );
    const blocker = await pool.connect();
    await blocker.query("SELECT pg_advisory_lock(87892144)");
    const writer = new PrismaGitHubInstallationRepository(
      prisma,
    ).upsertInstallation({
      githubInstallationId: "42",
      accountLogin: "race-team",
      accountType: "Organization",
      accountAvatarUrl: null,
      repositorySelection: "selected",
      status: "active",
    });
    let reader: Promise<Array<{ accountLogin: string }>> | undefined;
    try {
      let waiting = 0;
      for (let i = 0; i < 80 && waiting < 1; i++) {
        waiting = (
          await pool.query(
            "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0].n;
        if (waiting < 1) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(1);
      reader = prisma.$transaction(
        async (tx) => {
          await acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "shared" }]);
          return tx.$queryRaw<Array<{ accountLogin: string }>>(
            Prisma.sql`SELECT "accountLogin" FROM "GitHubInstallation" WHERE id='i'`,
          );
        },
        { isolationLevel: "ReadCommitted" },
      );
      for (let i = 0; i < 80 && waiting < 2; i++) {
        waiting = (
          await pool.query(
            "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0].n;
        if (waiting < 2) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(87892144)");
      blocker.release();
    }
    await writer;
    expect((await reader!)[0]?.accountLogin).toBe("race-team");
    await pool.query('DROP TRIGGER synthetic_hold ON "GitHubInstallation"');
  });

  it("enrolls the installation actor without changing existing roles", async () => {
    await new PrismaInstallationWorkspaceOwnerGrant(
      prisma,
    ).grantInstallationActorOwner({
      githubInstallationId: "42",
      githubUserId: "77",
      githubLogin: "synthetic-owner",
      avatarUrl: null,
    });
    expect(
      (
        await pool.query(
          'SELECT role::text FROM "WorkspaceMember" WHERE "githubLogin"=\'synthetic-owner\'',
        )
      ).rows[0].role,
    ).toBe("owner");
  });

  it("removes installation access and repository selection together", async () => {
    await new PrismaGitHubInstallationRepository(
      prisma,
    ).markInstallationRemoved("42");
    expect(
      (
        await pool.query(
          "SELECT status::text FROM \"GitHubInstallation\" WHERE id='i'",
        )
      ).rows[0].status,
    ).toBe("removed");
    expect(
      (
        await pool.query(
          "SELECT selected FROM \"RepositoryConnection\" WHERE id='r'",
        )
      ).rows[0].selected,
    ).toBe(false);
  });
});
