import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  claimVerifiedFencedWebhookDelivery,
  claimVerifiedFencedWebhookDeliveryInTransaction,
  createGitHubAppWebhookVerifier,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { handleFencedPullRequestComposite } from "./fenced-pull-request-composite";
import {
  writeFencedPullRequestIngress,
  writePullRequestIngressInTransaction,
} from "./fenced-pull-request-ingress";
import { PrismaWorkspaceReviewSettings } from "@reviewrouter/features-review-config/composition";
import { PrismaWebhookDeliveryRepository } from "@reviewrouter/features-github-installations";
const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("fenced PR composite on isolated PostgreSQL", () => {
  const schema = `webhook_composite_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    application_name: schema,
    ...webhookFencePostgres.connection,
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
    await assertWebhookFenceTestDatabase(pool);
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
    await pool.query(`CREATE TYPE "WorkspaceDeletionState" AS ENUM ('active','delete_pending','deleted');
      CREATE TABLE "Workspace" (id TEXT PRIMARY KEY, slug TEXT UNIQUE, name TEXT, "reviewDraftPullRequests" BOOLEAN DEFAULT true, "providerManagementAdminOnly" BOOLEAN DEFAULT false, "deletionState" "WorkspaceDeletionState" DEFAULT 'active', "deletionRevision" INT DEFAULT 1, "deletionTombstonedAt" TIMESTAMP(3), "personalOwnerUserId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (id,slug,name) VALUES ('workspace','synthetic','Synthetic workspace');`);
    await pool.query(
      'CREATE TABLE "GitHubInstallation" (id TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL DEFAULT \'workspace\',"githubInstallationId" BIGINT UNIQUE NOT NULL,status "GitHubInstallationStatus" NOT NULL DEFAULT \'active\')',
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
      "d".repeat(64),
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
      "d".repeat(64),
    );
    const result = await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackPolicy: {
        isConflictReviewFallbackAllowed: () => true,
      },
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
      "d".repeat(64),
    );
    const result = await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackPolicy: {
        isConflictReviewFallbackAllowed: () => false,
      },
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
      "d".repeat(64),
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    await expect(
      handleFencedPullRequestComposite(prisma, e, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: true,
        conflictFallbackPolicy: {
          isConflictReviewFallbackAllowed: () => true,
        },
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
      "d".repeat(64),
    );
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    await expect(
      handleFencedPullRequestComposite(prisma, e, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: true,
        conflictFallbackPolicy: {
          isConflictReviewFallbackAllowed: () => true,
        },
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
      "d".repeat(64),
    );
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
        await tx.$executeRaw(
          Prisma.sql`UPDATE "RepositoryConnection" SET "fullName"='new/name' WHERE id='repo'`,
        );
        entered();
        await gate;
      },
      { isolationLevel: "ReadCommitted" },
    );
    await ready;
    const oldHandler = handleFencedPullRequestComposite(prisma, e, old, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: true,
      conflictFallbackPolicy: {
        isConflictReviewFallbackAllowed: () => true,
      },
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
  it("rejects legacy failure and retry after fenced completion", async () => {
    const e = envelope("legacy-terminal");
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
      "d".repeat(64),
    );
    await handleFencedPullRequestComposite(prisma, e, claim, {
      reviewIngressEnabled: true,
      conflictFallbackEnabled: false,
    });
    const legacy = new PrismaWebhookDeliveryRepository(prisma);
    await expect(
      legacy.markFailed({
        deliveryId: e.deliveryId,
        errorSummary: "synthetic stale handler",
      }),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processed");
    expect(
      await legacy.tryStartProcessing({
        deliveryId: e.deliveryId,
        eventName: e.eventName,
        action: e.payload.action,
        installationId: "123",
        payloadHash: e.payloadHash,
      }),
    ).toBe(false);
  });
  it("keeps admitted PR work durable if the process stops before its generic effects", async () => {
    const e = envelope("crash-after-admission");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
    e.payload.pull_request.merged = false;
    const rawPayload = Buffer.from(JSON.stringify(e.payload));
    const webhookSecret = "isolated-webhook-fixture";
    const verified = createGitHubAppWebhookVerifier({
      appId: "42",
      apiBaseUrl: "https://api.github.com",
      webhookSecret,
    })({
      rawPayload,
      signatureHeader: `sha256=${createHmac("sha256", webhookSecret).update(rawPayload).digest("hex")}`,
    })!;
    e.payloadHash = verified.payloadHash;
    const delivery = {
      deliveryId: e.deliveryId,
      eventName: e.eventName,
      action: e.payload.action,
      installationId: "123",
      payloadHash: e.payloadHash,
    };
    const before = (
      await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')
    ).rows[0].n;
    const acquisition = await prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuards(tx, [
          { scope: "global", mode: "shared" },
        ]);
        const claim = await claimVerifiedFencedWebhookDeliveryInTransaction(
          tx,
          verified,
          delivery,
          owner,
          10000,
        );
        expect(claim.kind).toBe("claimed");
        await writePullRequestIngressInTransaction(tx, e);
        return claim;
      },
      { isolationLevel: "ReadCommitted" },
    );
    expect(acquisition.kind).toBe("claimed");
    // The initial transaction committed; no generic effect or failure callback
    // ran. This is the state left by process death at the handoff boundary.
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(before + 1);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processing");
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    const recovered = await claimVerifiedFencedWebhookDelivery(
      prisma,
      verified,
      delivery,
      "e".repeat(64),
      10000,
    );
    if (recovered.kind !== "claimed") throw new Error("recovery_claim_missing");
    await handleFencedPullRequestComposite(prisma, e, recovered.claim, {
      reviewIngressEnabled: false,
      conflictFallbackEnabled: false,
    });
    expect(
      (await pool.query('SELECT count(*)::int n FROM "OutboxEvent"')).rows[0].n,
    ).toBe(before + 1);
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processed");
  });
  it("reads the actual draft setting after waiting for its ordinary writer", async () => {
    const e = envelope("draft-policy-writer");
    e.payload.action = "opened";
    e.payload.pull_request.state = "open";
    e.payload.pull_request.merged = false;
    e.payload.pull_request.draft = true;
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
    await pool.query(`UPDATE "Workspace" SET "reviewDraftPullRequests"=true WHERE id='workspace';
      CREATE FUNCTION synthetic_hold_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87892345); RETURN NEW; END $$;
      CREATE TRIGGER synthetic_hold_policy BEFORE UPDATE ON "Workspace" FOR EACH ROW EXECUTE FUNCTION synthetic_hold_policy();`);
    const blocker = await pool.connect();
    await blocker.query("SELECT pg_advisory_lock(87892345)");
    const writer = new PrismaWorkspaceReviewSettings(prisma).save(
      "workspace",
      false,
    );
    let reader: Promise<Record<string, unknown>> | undefined;
    try {
      let writerWaiting = false;
      for (let attempt = 0; attempt < 80 && !writerWaiting; attempt++) {
        writerWaiting =
          (
            await pool.query(
              "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory') waiting",
              [schema],
            )
          ).rows[0].waiting === true;
        if (!writerWaiting)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(writerWaiting).toBe(true);
      reader = writeFencedPullRequestIngress(prisma, e, claim);
      let readerWaiting = false;
      for (let attempt = 0; attempt < 80 && !readerWaiting; attempt++) {
        readerWaiting =
          (
            await pool.query(
              "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND wait_event <> 'advisory') waiting",
              [schema],
            )
          ).rows[0].waiting === true;
        if (!readerWaiting)
          await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(readerWaiting).toBe(true);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(87892345)");
      blocker.release();
    }
    try {
      await writer;
      await expect(reader).resolves.toMatchObject({ commandKind: "cancel" });
    } finally {
      await pool.query('DROP TRIGGER synthetic_hold_policy ON "Workspace"');
    }
  });
});
