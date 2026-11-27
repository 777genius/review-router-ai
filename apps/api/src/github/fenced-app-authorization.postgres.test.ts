import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import Fastify from "fastify";
import { encryptServerToken } from "@reviewrouter/features-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler";

const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("fenced app revocation on isolated PostgreSQL", () => {
  const schema = `webhook_app_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    options: `-c search_path=${schema} -c timezone=Pacific/Honolulu`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const env = {
    GITHUB_APP_SLUG: "synthetic-app",
    REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY:
      "synthetic-app-revocation-encryption-key",
  };
  const github = Fastify({ logger: false });
  let githubOrigin = "";
  const token = encryptServerToken("synthetic-current-token", env);
  const handler = () =>
    new PrismaGitHubAppAuthorizationWebhookHandler(
      prisma,
      env.GITHUB_APP_SLUG,
      {
        env,
        fetch: async (resource, options) => {
          expect(String(resource)).toBe("https://api.github.com/user");
          return fetch(githubOrigin + "/user", options);
        },
      },
    );
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
    await assertWebhookFenceTestDatabase(pool);
    expect((await pool.query("SHOW timezone")).rows[0]?.TimeZone).toBe(
      "Pacific/Honolulu",
    );
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
      `CREATE TABLE "GitHubUserAuthorization" (id TEXT PRIMARY KEY DEFAULT 'authorization', "userId" TEXT, "appSlug" TEXT, "githubUserId" BIGINT NOT NULL DEFAULT 123, revision INT NOT NULL DEFAULT 1, "encryptedAccessToken" TEXT NOT NULL, "accessTokenExpiresAt" TIMESTAMP(3), "refreshAttemptId" TEXT, "revokedAt" TIMESTAMP(3), "lastErrorCode" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    await pool.query(
      'CREATE TABLE "RepositoryPermissionCache" ("userId" TEXT, "authorizationAppSlug" TEXT)',
    );
    await pool.query("INSERT INTO \"User\" VALUES ('u1',123)");
    github.get("/user", async (request, reply) => {
      expect(request.headers.authorization).toBe(
        "Bearer synthetic-current-token",
      );
      return reply.code(401).send({});
    });
    githubOrigin = await github.listen({ host: "127.0.0.1", port: 0 });
  });
  afterAll(async () => {
    await github.close();
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("commits revocation, cache removal and terminal status together", async () => {
    await pool.query(
      `INSERT INTO "GitHubUserAuthorization" ("userId","appSlug","encryptedAccessToken","accessTokenExpiresAt")
        VALUES ('u1','synthetic-app',$1,$2::timestamp)`,
      [token, new Date(Date.now() + 3_600_000).toISOString()],
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
      "d".repeat(64),
    );
    await handler().handleFencedGitHubAppAuthorizationWebhook(e, claim);
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
          `SELECT abs(EXTRACT(EPOCH FROM ("revokedAt" - (clock_timestamp() AT TIME ZONE 'UTC')))) < 30
            AND abs(EXTRACT(EPOCH FROM ("updatedAt" - (clock_timestamp() AT TIME ZONE 'UTC')))) < 30
            AS "utcTimestamps" FROM "GitHubUserAuthorization"`,
        )
      ).rows[0]?.utcTimestamps,
    ).toBe(true);
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
      "d".repeat(64),
    );
    await pool.query(
      "ALTER TABLE \"GitHubWebhookDelivery\" ADD CONSTRAINT synthetic_completion_failure CHECK (\"deliveryId\" <> 'app-rollback' OR status <> 'processed')",
    );
    await expect(
      handler().handleFencedGitHubAppAuthorizationWebhook(e, claim),
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
  it("does not reclaim an expired revocation or revoke a later authorization", async () => {
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
      "d".repeat(64),
    );
    // A local reconnect may install a later grant while this receipt waits.
    await pool.query(
      'UPDATE "GitHubUserAuthorization" SET "revokedAt"=NULL,revision=2,"refreshAttemptId"=NULL',
    );
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    expect(
      await reclaimWebhookFence(prisma, previous, "b".repeat(64), 10000),
    ).toBeNull();
    expect(
      (
        await pool.query(
          'SELECT generation::text,"ownerHash" FROM "GitHubWebhookFence" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0],
    ).toEqual({ generation: "1", ownerHash: owner });
    await expect(
      handler().handleFencedGitHubAppAuthorizationWebhook(e, previous),
    ).rejects.toThrow("webhook_fence_stale");
    expect(
      (
        await pool.query(
          'SELECT "revokedAt" IS NULL AS unchanged,revision FROM "GitHubUserAuthorization"',
        )
      ).rows[0],
    ).toEqual({ unchanged: true, revision: 2 });
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
  it("does not mistake an expired UTC token for a current grant in a negative-offset session", async () => {
    await pool.query(
      'UPDATE "GitHubUserAuthorization" SET "revokedAt"=NULL,revision=3,"accessTokenExpiresAt"=$1::timestamp',
      [new Date(Date.now() - 60_000).toISOString()],
    );
    const e = envelope("app-expired-token");
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
      "d".repeat(64),
    );
    await expect(
      handler().handleFencedGitHubAppAuthorizationWebhook(e, claim),
    ).rejects.toThrow("github_app_authorization_reconciliation_required");
    expect(
      (
        await pool.query(
          'SELECT "revokedAt" IS NULL AS unchanged,revision FROM "GitHubUserAuthorization"',
        )
      ).rows[0],
    ).toEqual({ unchanged: true, revision: 3 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "RepositoryPermissionCache"',
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
