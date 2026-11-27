import { createHmac, randomBytes } from "node:crypto";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { createGitHubAppWebhookVerifier } from "../infrastructure/crypto/github-app-webhook-verifier";
import { verifyGitHubAppWebhookRequest } from "../interface/http/verify-github-app-webhook-request";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  beginVerifiedFencedWebhookDelivery,
} from "../infrastructure/prisma/webhook-effect-fence";
import {
  prepareWebhookRecovery,
  reserveWebhookRedeliveryOnce,
  recordWebhookRedeliveryAccepted,
  confirmWebhookRecovery,
} from "../infrastructure/prisma/webhook-recovery-custody";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("webhook recovery custody on isolated PostgreSQL", () => {
  const schema = `webhook_recovery_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const identity = (deliveryGuid: string) => ({
    appIdentityHash: "d".repeat(64),
    deliveryGuid,
    githubDeliveryId: 33n,
    eventName: "pull_request",
    action: "opened",
    installationId: 123n,
    payloadHash: "a".repeat(64),
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
      CREATE TABLE "GitHubWebhookDelivery" (id TEXT PRIMARY KEY DEFAULT 'synthetic-' || md5(random()::text), "deliveryId" TEXT UNIQUE NOT NULL, "eventName" TEXT NOT NULL, action TEXT, "installationId" BIGINT, "payloadHash" TEXT, "normalizedEvent" JSONB, status "WebhookDeliveryStatus" NOT NULL DEFAULT 'processing', "errorSummary" TEXT, "processedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for (const migration of [
      "000165_webhook_effect_fence",
      "000167_webhook_recovery_intent",
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
  it("binds a signed HTTP body to its configured App and DB fence", async () => {
    const app = Fastify();
    const secret = "synthetic-secret";
    const verify = createGitHubAppWebhookVerifier({
      appId: "123",
      apiBaseUrl: "https://api.github.com",
      webhookSecret: secret,
    });
    await app.register(rawBody, {
      field: "rawBody",
      global: false,
      encoding: false,
      runFirst: true,
      routes: ["/synthetic"],
    });
    app.post("/synthetic", async (request, reply) => {
      const context = verifyGitHubAppWebhookRequest(request, verify);
      if (!context) return reply.code(401).send({ error: "invalid_signature" });
      const claim = await beginVerifiedFencedWebhookDelivery(
        prisma,
        context,
        {
          deliveryId: "synthetic-http",
          eventName: "push",
          payloadHash: context.payloadHash,
        },
        "b".repeat(64),
        10000,
      );
      return { appIdentityHash: claim.appIdentityHash };
    });
    try {
      const payload = '{"action":"opened"}';
      const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      const bad = await app.inject({
        method: "POST",
        url: "/synthetic",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
        },
        payload: '{"action":"changed"}',
      });
      expect(bad.statusCode).toBe(401);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM "GitHubWebhookFence" WHERE "deliveryId"=\'synthetic-http\'',
          )
        ).rows[0].n,
      ).toBe(0);
      const good = await app.inject({
        method: "POST",
        url: "/synthetic",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-app-id": "999",
        },
        payload,
      });
      expect(good.statusCode).toBe(200);
      const trusted = verify({
        rawPayload: Buffer.from(payload),
        signatureHeader: signature,
      });
      expect(good.json().appIdentityHash).toBe(trusted?.appIdentityHash);
      expect(
        (
          await pool.query(
            'SELECT "appIdentityHash" FROM "GitHubWebhookFence" WHERE "deliveryId"=\'synthetic-http\'',
          )
        ).rows[0].appIdentityHash,
      ).toBe(trusted?.appIdentityHash);
    } finally {
      await app.close();
    }
  });

  it("concurrent reservations grant at most one POST and 202 is not completion", async () => {
    const i = identity("reservation");
    await prepareWebhookRecovery(prisma, i);
    const reservations = await Promise.all([
      reserveWebhookRedeliveryOnce(prisma, i),
      reserveWebhookRedeliveryOnce(prisma, i),
    ]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    expect(await reserveWebhookRedeliveryOnce(prisma, i)).toBe(false);
    expect(await confirmWebhookRecovery(prisma, i)).toBe(false);
    expect(await recordWebhookRedeliveryAccepted(prisma, i)).toBe(true);
    expect(await confirmWebhookRecovery(prisma, i)).toBe(false);
    expect(
      (
        await pool.query(
          'SELECT state FROM "GitHubWebhookRecoveryIntent" WHERE "deliveryGuid"=$1',
          [i.deliveryGuid],
        )
      ).rows[0].state,
    ).toBe("accepted");
  });
  it("retains unknown outcome and rejects conflicting immutable identity", async () => {
    const i = identity("unknown");
    await prepareWebhookRecovery(prisma, i);
    expect(await reserveWebhookRedeliveryOnce(prisma, i)).toBe(true);
    expect((await prepareWebhookRecovery(prisma, i)).state).toBe(
      "issued_unknown",
    );
    expect(await reserveWebhookRedeliveryOnce(prisma, i)).toBe(false);
    await expect(
      prepareWebhookRecovery(prisma, { ...i, githubDeliveryId: 34n }),
    ).rejects.toThrow("webhook_recovery_identity_conflict");
    expect(
      await recordWebhookRedeliveryAccepted(prisma, {
        ...i,
        payloadHash: "b".repeat(64),
      }),
    ).toBe(false);
  });
  it("confirms only the exact fenced App, event, installation and payload after receiver terminal", async () => {
    const i = identity("receiver");
    await prepareWebhookRecovery(prisma, i);
    await reserveWebhookRedeliveryOnce(prisma, i);
    await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: i.deliveryGuid,
        eventName: i.eventName,
        action: i.action,
        installationId: String(i.installationId),
        payloadHash: i.payloadHash,
      },
      "b".repeat(64),
      10000,
      i.appIdentityHash,
    );
    expect(await confirmWebhookRecovery(prisma, i)).toBe(false);
    await pool.query(
      'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
      [i.deliveryGuid],
    );
    expect(
      await confirmWebhookRecovery(prisma, {
        ...i,
        appIdentityHash: "e".repeat(64),
      }),
    ).toBe(false);
    expect(
      await confirmWebhookRecovery(prisma, {
        ...i,
        payloadHash: "b".repeat(64),
      }),
    ).toBe(false);
    expect(await confirmWebhookRecovery(prisma, i)).toBe(true);
    expect(await reserveWebhookRedeliveryOnce(prisma, i)).toBe(false);
  });
});
