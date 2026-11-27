import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { handleFencedPushWebhook } from "./fenced-push-webhook";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("fenced push on isolated PostgreSQL", () => {
  const schema = `webhook_push_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const owner = "a".repeat(64),
    sha = "b".repeat(40);
  const envelope = (deliveryId: string) => ({
    deliveryId,
    eventName: "pull_request" as const,
    payloadHash: "hash",
    payload: {
      action: "closed",
      installation: { id: 123 },
      repository: { id: 456, name: "widget", full_name: "acme/widget" },
      pull_request: {
        number: 7,
        html_url: "https://github.com/acme/widget/pull/7",
        state: "closed",
        merged: true,
        draft: false,
        base: { ref: "main", sha },
        head: {
          ref: "reviewrouter/setup",
          sha,
          repo: { full_name: "acme/widget" },
        },
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
    await pool.query(
      "CREATE TYPE \"WebhookDeliveryStatus\" AS ENUM ('received','processing','processed','failed')",
    );
    await pool.query(
      "CREATE TYPE \"WorkflowProvisioningStatus\" AS ENUM ('not_started','setup_pr_open','failed','configured')",
    );
    await pool.query("CREATE TYPE \"ScmProvider\" AS ENUM ('github','gitlab')");
    await pool.query(
      "CREATE TYPE \"GitHubInstallationStatus\" AS ENUM ('active','suspended','removed')",
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
      await readFile(
        new URL(
          "../../../../packages/platform/db/prisma/migrations/000166_current_scope_epoch/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pool.query(
      'CREATE TABLE "GitHubInstallation" (id TEXT PRIMARY KEY,"githubInstallationId" BIGINT UNIQUE NOT NULL,status "GitHubInstallationStatus" NOT NULL DEFAULT \'active\')',
    );
    await pool.query(
      'CREATE TABLE "RepositoryConnection" (id TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"installationId" TEXT,"githubRepositoryId" BIGINT UNIQUE NOT NULL,provider "ScmProvider" NOT NULL DEFAULT \'github\',"defaultBranch" TEXT NOT NULL,"fullName" TEXT NOT NULL,selected BOOLEAN NOT NULL,archived BOOLEAN NOT NULL DEFAULT false)',
    );
    await pool.query(
      `CREATE TABLE "WorkflowProvisioning" (id TEXT PRIMARY KEY,"attemptId" TEXT NOT NULL,revision INT NOT NULL,"installationId" TEXT,"workspaceId" TEXT NOT NULL,"repositoryId" TEXT UNIQUE NOT NULL,status "WorkflowProvisioningStatus" NOT NULL,branch TEXT NOT NULL,"workflowPath" TEXT NOT NULL,"workflowStyle" TEXT NOT NULL,"actionVersion" TEXT NOT NULL,"pullRequestHeadSha" TEXT,"pullRequestUrl" TEXT,"errorMessage" TEXT,"attemptWorkflowRequirement" TEXT,"installedWorkflowRequirement" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    await pool.query(`CREATE TYPE "OutboxEventStatus" AS ENUM ('pending','processing','retry_wait','processed','dead_letter');
      CREATE TABLE "OutboxEvent" (id TEXT PRIMARY KEY, type TEXT NOT NULL, version INT NOT NULL, "idempotencyKey" TEXT UNIQUE NOT NULL, "workspaceId" TEXT, "repositoryId" TEXT, "aggregateId" TEXT, payload JSONB NOT NULL, status "OutboxEventStatus" DEFAULT 'pending', attempts INT DEFAULT 0, "maxAttempts" INT DEFAULT 5, "nextAttemptAt" TIMESTAMP(3), "claimId" TEXT, "claimVersion" BIGINT, "claimOwnerHash" TEXT, "claimUntil" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "deadLetteredAt" TIMESTAMP(3), "lastErrorCode" TEXT, "safeLastErrorSummary" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(
      'INSERT INTO "GitHubInstallation" (id,"githubInstallationId") VALUES (\'inst\',123)',
    );
    await pool.query(
      'INSERT INTO "RepositoryConnection" (id,"workspaceId","installationId","githubRepositoryId","defaultBranch","fullName",selected) VALUES (\'repo\',\'workspace\',\'inst\',456,\'main\',\'acme/widget\',true)',
    );
    await pool.query(
      "INSERT INTO \"WorkflowProvisioning\" (id,\"attemptId\",revision,\"installationId\",\"workspaceId\",\"repositoryId\",status,branch,\"workflowPath\",\"workflowStyle\",\"actionVersion\",\"pullRequestHeadSha\",\"pullRequestUrl\",\"attemptWorkflowRequirement\") VALUES ('setup','attempt',1,'inst','workspace','repo','setup_pr_open','reviewrouter/setup','.github/workflows/reviewrouter-review.yml','reusable','workflow-v1',$1,'https://github.com/acme/widget/pull/7','ci_secrets')",
      [sha],
    );
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
});
