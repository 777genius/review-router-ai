import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler";

const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("fenced app revocation on isolated PostgreSQL", () => {
  const schema = `webhook_app_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const owner = "a".repeat(64);
  const envelope = (deliveryId: string) => ({
    deliveryId,
    eventName: "github_app_authorization" as const,
    payloadHash: "hash",
    payload: {
      action: "revoked" as const,
      sender: { id: 123, login: "synthetic" },
    },
  });
  beforeAll(async () => {
    if (!socket?.startsWith("/")) throw new Error("test_socket_required");
    if (
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
      "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
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
      'CREATE TABLE "User" (id TEXT PRIMARY KEY, "githubUserId" BIGINT)',
    );
    await pool.query(
      'CREATE TABLE "GitHubUserAuthorization" ("userId" TEXT, "appSlug" TEXT, revision INT NOT NULL DEFAULT 1, "refreshAttemptId" TEXT, "revokedAt" TIMESTAMP(3), "lastErrorCode" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    await pool.query(
      'CREATE TABLE "RepositoryPermissionCache" ("userId" TEXT, "authorizationAppSlug" TEXT)',
    );
    await pool.query("INSERT INTO \"User\" VALUES ('u1',123)");
    vi.stubEnv("GITHUB_APP_SLUG", "synthetic-app");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("commits revocation, cache removal and terminal status together", async () => {
    await pool.query(
      'INSERT INTO "GitHubUserAuthorization" ("userId","appSlug") VALUES (\'u1\',\'synthetic-app\')',
    );
    await pool.query(
      "INSERT INTO \"RepositoryPermissionCache\" VALUES ('u1','synthetic-app')",
    );
    const e = envelope("app-success");
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        payloadHash: e.payloadHash,
      },
      owner,
      10000,
    );
    await new PrismaGitHubAppAuthorizationWebhookHandler(
      prisma,
    ).handleFencedGitHubAppAuthorizationWebhook(e, claim);
    expect(
      (
        await pool.query(
          'SELECT "revokedAt" IS NOT NULL AS revoked,revision FROM "GitHubUserAuthorization"',
        )
      ).rows[0],
    ).toEqual({ revoked: true, revision: 2 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "RepositoryPermissionCache"',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processed");
  });
  it("rolls back revocation and cache removal when completion fails", async () => {
    await pool.query(
      'UPDATE "GitHubUserAuthorization" SET "revokedAt"=NULL,revision=1',
    );
    await pool.query(
      "INSERT INTO \"RepositoryPermissionCache\" VALUES ('u1','synthetic-app')",
    );
    const e = envelope("app-rollback");
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        payloadHash: e.payloadHash,
      },
      owner,
      10000,
    );
    await pool.query(
      "ALTER TABLE \"GitHubWebhookDelivery\" ADD CONSTRAINT synthetic_completion_failure CHECK (\"deliveryId\" <> 'app-rollback' OR status <> 'processed')",
    );
    await expect(
      new PrismaGitHubAppAuthorizationWebhookHandler(
        prisma,
      ).handleFencedGitHubAppAuthorizationWebhook(e, claim),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT "revokedAt" IS NULL AS unchanged,revision FROM "GitHubUserAuthorization"',
        )
      ).rows[0],
    ).toEqual({ unchanged: true, revision: 1 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "RepositoryPermissionCache"',
        )
      ).rows[0].n,
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
  it("does not apply stale-owner effects after takeover", async () => {
    const e = envelope("app-stale");
    const previous = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        payloadHash: e.payloadHash,
      },
      owner,
      10000,
    );
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    expect(
      await reclaimWebhookFence(prisma, previous, "b".repeat(64), 10000),
    ).not.toBeNull();
    await expect(
      new PrismaGitHubAppAuthorizationWebhookHandler(
        prisma,
      ).handleFencedGitHubAppAuthorizationWebhook(e, previous),
    ).rejects.toThrow("webhook_fence_stale");
    expect(
      (
        await pool.query(
          'SELECT "revokedAt" IS NULL AS unchanged,revision FROM "GitHubUserAuthorization"',
        )
      ).rows[0],
    ).toEqual({ unchanged: true, revision: 1 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "RepositoryPermissionCache"',
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
