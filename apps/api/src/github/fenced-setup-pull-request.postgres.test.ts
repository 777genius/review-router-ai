import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
} from "@reviewrouter/features-github-installations";
import { PrismaSetupPullRequestMergeHandler } from "./prisma-setup-pull-request-merge-handler";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("fenced setup merge on isolated PostgreSQL", () => {
  const schema = `webhook_setup_${randomBytes(8).toString("hex")}`;
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
        base: { ref: "main" },
        head: { ref: "reviewrouter/setup", sha },
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
  it("updates setup in the fenced transaction while leaving delivery processing", async () => {
    const e = envelope("setup-success");
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
    const result = await new PrismaSetupPullRequestMergeHandler(
      prisma,
    ).handleFencedGitHubPullRequestWebhook(e, claim);
    expect(result).toMatchObject({ processed: true, status: "configured" });
    expect(
      (await pool.query('SELECT status::text FROM "WorkflowProvisioning"'))
        .rows[0].status,
    ).toBe("configured");
    expect(
      (
        await pool.query(
          'SELECT status::text FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
          [e.deliveryId],
        )
      ).rows[0].status,
    ).toBe("processing");
  });
  it("does not update setup when the owner is stale", async () => {
    await pool.query(
      "UPDATE \"WorkflowProvisioning\" SET status='setup_pr_open',revision=1",
    );
    const e = envelope("setup-stale");
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
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [e.deliveryId],
    );
    expect(
      await reclaimWebhookFence(prisma, claim, "b".repeat(64), 10000),
    ).not.toBeNull();
    await expect(
      new PrismaSetupPullRequestMergeHandler(
        prisma,
      ).handleFencedGitHubPullRequestWebhook(e, claim),
    ).rejects.toThrow("webhook_fence_stale");
    expect(
      (
        await pool.query(
          'SELECT status::text,revision FROM "WorkflowProvisioning"',
        )
      ).rows[0],
    ).toEqual({ status: "setup_pr_open", revision: 1 });
  });
  it("rolls back the setup update if its fence expires during the write", async () => {
    await pool.query(
      "CREATE FUNCTION synthetic_delay_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.75); RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER synthetic_delay BEFORE UPDATE ON "WorkflowProvisioning" FOR EACH ROW EXECUTE FUNCTION synthetic_delay_setup()',
    );
    const e = envelope("setup-expiry");
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
      500,
    );
    await expect(
      new PrismaSetupPullRequestMergeHandler(
        prisma,
      ).handleFencedGitHubPullRequestWebhook(e, claim),
    ).rejects.toThrow("webhook_fence_expired");
    expect(
      (
        await pool.query(
          'SELECT status::text,revision FROM "WorkflowProvisioning"',
        )
      ).rows[0],
    ).toEqual({ status: "setup_pr_open", revision: 1 });
  });
});
