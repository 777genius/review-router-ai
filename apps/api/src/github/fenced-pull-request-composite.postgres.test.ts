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
import { handleFencedPullRequestComposite } from "./fenced-pull-request-composite";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("fenced PR composite on isolated PostgreSQL", () => {
  const schema = `webhook_composite_${randomBytes(8).toString("hex")}`;
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
  async function begin(deliveryId: string) {
    const e = envelope(deliveryId);
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: "hash",
      },
      owner,
      10000,
    );
    return { e, claim };
  }
  it("commits review ingress and setup update together", async () => {
    const { e, claim } = await begin("composite-success");
    const result = await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: false,
    });
    expect(result.setup).toMatchObject({
      processed: true,
      status: "configured",
    });
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT status::text FROM "WorkflowProvisioning"'))
        .rows[0].status,
    ).toBe("configured");
  });
  it("rolls back ingress if setup update fails", async () => {
    await pool.query(
      "UPDATE \"WorkflowProvisioning\" SET status='setup_pr_open',revision=1",
    );
    await pool.query(
      "ALTER TABLE \"WorkflowProvisioning\" ADD CONSTRAINT synthetic_no_configured CHECK (status <> 'configured')",
    );
    const { e, claim } = await begin("composite-rollback");
    await expect(
      handleFencedPullRequestComposite(prisma, e, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: false,
      }),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT status::text FROM "WorkflowProvisioning"'))
        .rows[0].status,
    ).toBe("setup_pr_open");
  });
  it("writes conflict and review outbox events together when fallback is allowed", async () => {
    const e = envelope("conflict-allowed");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
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
    );
    const result = await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackAllowed: true,
    });
    expect(result.conflict).toMatchObject({ processed: true, queued: true });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "OutboxEvent" WHERE "idempotencyKey"=$1',
          ["conflict-review:detect:delivery:conflict-allowed"],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("respects disabled conflict policy", async () => {
    const e = envelope("conflict-denied");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
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
    );
    const result = await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackAllowed: false,
    });
    expect(result.conflict).toMatchObject({
      processed: false,
      queued: false,
      reason: "conflict_review_rollout_disabled",
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "OutboxEvent" WHERE "idempotencyKey"=$1',
          ["conflict-review:detect:delivery:conflict-denied"],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("rolls back review ingress when conflict outbox insertion fails", async () => {
    await pool.query(
      `ALTER TABLE "OutboxEvent" ADD CONSTRAINT synthetic_conflict_failure CHECK ("idempotencyKey" <> 'conflict-review:detect:delivery:conflict-rollback')`,
    );
    const e = envelope("conflict-rollback");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
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
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    await expect(
      handleFencedPullRequestComposite(prisma, e, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: true,
        conflictFallbackAllowed: true,
      }),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(before);
  });
  it("rolls back every effect if terminal status cannot commit", async () => {
    await pool.query(
      `ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT synthetic_terminal_failure CHECK ("deliveryId" <> 'terminal-fail' OR status <> 'processed')`,
    );
    const e = envelope("terminal-fail");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
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
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    await expect(
      handleFencedPullRequestComposite(prisma, e, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: true,
        conflictFallbackAllowed: true,
      }),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(before);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processing");
  });

  it("rejects the prior owner after scope change and takeover race", async () => {
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    const e = envelope("composite-race");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
    const old = await beginFencedWebhookDelivery(
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
    );
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = runScopeEpochSerializableTransaction(
      prisma,
      [{ scope: "global", mode: "exclusive" }],
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`UPDATE "RepositoryConnection" SET "fullName"='new/name' WHERE id='repo'`,
        );
        entered();
        await gate;
      },
    );
    await ready;
    const oldHandler = handleFencedPullRequestComposite(prisma, e, old, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackAllowed: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      let waiting = false;
      for (let i = 0; i < 80 && !waiting; i++) {
        waiting =
          (
            await pool.query(
              "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
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
        await reclaimWebhookFence(prisma, old, "c".repeat(64), 10000),
      ).not.toBeNull();
    } finally {
      release();
    }
    await writer;
    expect(await oldHandler).toBeInstanceOf(Error);
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(before);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "OutboxEvent" WHERE "idempotencyKey"=$1',
          ["conflict-review:detect:delivery:composite-race"],
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
    ).toBe("processing");
  });
});
