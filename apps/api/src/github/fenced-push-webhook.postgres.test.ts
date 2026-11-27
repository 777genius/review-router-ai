import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginFencedWebhookDelivery } from "@reviewrouter/features-github-installations";
import { handleFencedPushWebhook } from "./fenced-push-webhook";
const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("fenced push on isolated PostgreSQL", () => {
  const schema = `webhook_push_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const owner = "a".repeat(64);
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
    await pool.query(`CREATE TYPE "OutboxEventStatus" AS ENUM ('pending','processing','retry_wait','processed','dead_letter');
      CREATE TABLE "OutboxEvent" (id TEXT PRIMARY KEY, type TEXT NOT NULL, version INT NOT NULL, "idempotencyKey" TEXT UNIQUE NOT NULL, "workspaceId" TEXT, "repositoryId" TEXT, "aggregateId" TEXT, payload JSONB NOT NULL, status "OutboxEventStatus" DEFAULT 'pending', attempts INT DEFAULT 0, "maxAttempts" INT DEFAULT 5, "nextAttemptAt" TIMESTAMP(3), "claimId" TEXT, "claimVersion" BIGINT, "claimOwnerHash" TEXT, "claimUntil" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "deadLetteredAt" TIMESTAMP(3), "lastErrorCode" TEXT, "safeLastErrorSummary" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  function push(deliveryId: string) {
    return {
      deliveryId,
      eventName: "push" as const,
      payloadHash: "hash",
      payload: {
        installation: { id: 123 },
        repository: { id: 456, name: "widget", full_name: "acme/widget" },
        ref: "refs/heads/main",
        deleted: false,
      },
    };
  }
  async function begin(deliveryId: string) {
    const e = push(deliveryId);
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId,
        eventName: e.eventName,
        action: "push",
        installationId: "123",
        payloadHash: "hash",
      },
      owner,
      10000,
      "d".repeat(64),
    );
    return { e, claim };
  }
  it("commits conflict request and terminal state", async () => {
    const { e, claim } = await begin("push-success");
    expect(await handleFencedPushWebhook(prisma, e, claim, true)).toMatchObject(
      { processed: true, queued: true },
    );
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processed");
  });
  it("rolls back conflict request on terminal failure", async () => {
    await pool.query(
      `ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT synthetic_push_failure CHECK ("deliveryId" <> 'push-rollback' OR status <> 'processed')`,
    );
    const { e, claim } = await begin("push-rollback");
    await expect(
      handleFencedPushWebhook(prisma, e, claim, true),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processing");
  });
  it("honors deny policy", async () => {
    const { e, claim } = await begin("push-denied");
    expect(
      await handleFencedPushWebhook(prisma, e, claim, false),
    ).toMatchObject({
      processed: false,
      queued: false,
      reason: "conflict_review_rollout_disabled",
    });
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
  });
  it("rejects stale owners and mismatched payload hashes", async () => {
    const { e, claim } = await begin("push-stale");
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET generation=generation+1 WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    await expect(
      handleFencedPushWebhook(prisma, e, claim, true),
    ).rejects.toThrow();
    const mismatch = await begin("push-mismatch");
    await expect(
      handleFencedPushWebhook(
        prisma,
        { ...mismatch.e, payloadHash: "other" },
        mismatch.claim,
        true,
      ),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
  });
  it("does not serialize push outbox work behind unrelated authority writers", async () => {
    const { e, claim } = await begin("push-independent");
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuards(tx, [
          { scope: "global", mode: "exclusive" },
        ]);
        entered();
        await gate;
      },
      { isolationLevel: "ReadCommitted" },
    );
    await ready;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        handleFencedPushWebhook(prisma, e, claim, true),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("push_waited_for_unrelated_scope")),
            2000,
          );
        }),
      ]);
      expect(result).toMatchObject({ processed: true, queued: true });
    } finally {
      clearTimeout(timeout);
      release();
      await writer;
    }
  });
});
