import { webhookFencePostgres, assertWebhookFenceTestDatabase } from "../../../../scripts/webhook-fencing/postgres-fixture";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  claimVerifiedFencedWebhookDelivery,
  failWebhookFencedDelivery,
  runWebhookFencedDatabaseEffect,
  createGitHubAppWebhookVerifier,
  prepareWebhookRecovery,
  reserveWebhookRedeliveryOnce,
  recordWebhookRedeliveryAccepted,
  confirmWebhookRecovery,
  requestWebhookRedeliveryOnce,
  pollWebhookRecovery,
} from "@reviewrouter/features-github-installations";
import { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";
import { GitHubAppWebhookRecoveryAuthority } from "./github-app-webhook-recovery-authority";
const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("recovery authority with synthetic GitHub and isolated PostgreSQL", () => {
  const schema = `recovery_authority_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const raw = Buffer.from('{"synthetic":true}');
  const signature = `sha256=${createHmac("sha256", "synthetic-secret").update(raw).digest("hex")}`;
  const verified = createGitHubAppWebhookVerifier({ appId: "123", apiBaseUrl: "https://api.github.com", webhookSecret: "synthetic-secret" })({ rawPayload: raw, signatureHeader: signature })!;
  let calls = 0,
    posts = 0,
    guid = "synthetic";
  let origin = "";
  const server = createServer((req, res) => {
    calls++;
    if (req.method === "POST") {
      posts++;
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.includes("?")) {
      res.end(
        JSON.stringify([
          {
            id: 43,
            guid,
            event: "push",
            action: null,
            installation_id: 123,
            redelivery: true,
            status_code: 200,
          },
        ]),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: 42,
        guid,
        event: "push",
        action: null,
        installation_id: 123,
        request: { headers: { "X-Hub-Signature-256": signature }, payload: { synthetic: "never-return" } },
      }),
    );
  });
  let client: GitHubAppWebhookRedeliveryClient;
  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      `CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('received','processing','processed','failed'); CREATE TABLE "GitHubWebhookDelivery" (id TEXT PRIMARY KEY DEFAULT 'synthetic-' || md5(random()::text), "deliveryId" TEXT UNIQUE NOT NULL, "eventName" TEXT NOT NULL, action TEXT, "installationId" BIGINT, "payloadHash" TEXT, "normalizedEvent" JSONB, status "WebhookDeliveryStatus" NOT NULL DEFAULT 'processing', "errorSummary" TEXT, "processedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    for (const migration of [
      "000165_webhook_effect_fence",
      "000167_webhook_recovery_intent",
    ])
      await pool.query(
        await readFile(
          new URL(
            `../../../../packages/platform/db/prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      "123",
      async () => "synthetic-jwt",
      async (resource, options) => {
        const url = new URL(String(resource));
        if (url.origin !== "https://api.github.com")
          throw new Error("unexpected_origin");
        return fetch(`${origin}${url.pathname}${url.search}`, options);
      },
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  async function completeFailed(identity: { deliveryGuid: string; eventName: string; action: string; payloadHash: string }) {
    const result = await claimVerifiedFencedWebhookDelivery(prisma, verified, {
      deliveryId: identity.deliveryGuid, eventName: identity.eventName, action: identity.action,
      installationId: "123", payloadHash: identity.payloadHash,
    }, "c".repeat(64), 10000);
    if (result.kind !== "claimed") throw new Error("claim_required");
    await runWebhookFencedDatabaseEffect(prisma, result.claim, async (tx) => {
      await tx.gitHubWebhookDelivery.update({ where: { deliveryId: identity.deliveryGuid }, data: { status: "processed" } });
    }, "processed");
  }

  it("requires exact failed receiver evidence and exact GitHub App delivery, then rechecks at reserve", async () => {
    const identity = {
      appIdentityHash: client.appIdentityHash,
      deliveryGuid: "synthetic",
      githubDeliveryId: 42n,
      eventName: "push",
      action: "push",
      installationId: 123n,
      payloadHash: verified.payloadHash,
    };
    const authority = new GitHubAppWebhookRecoveryAuthority(prisma, client);
    expect(await authority.authorize(identity)).toBe(false);
    expect(calls).toBe(0);
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: identity.deliveryGuid,
        eventName: identity.eventName,
        action: identity.action,
        installationId: "123",
        payloadHash: identity.payloadHash,
      },
      "b".repeat(64),
      10000,
      identity.appIdentityHash,
      verified.signatureHash,
    );
    expect(await authority.authorize(identity)).toBe(false);
    expect(calls).toBe(0);
    await failWebhookFencedDelivery(prisma, claim, "synthetic_failure");
    guid = "wrong";
    expect(await authority.authorize(identity)).toBe(false);
    guid = "synthetic";
    expect(await authority.authorize(identity)).toBe(true);
    await prepareWebhookRecovery(prisma, identity);
    await completeFailed(identity);
    expect(
      await reserveWebhookRedeliveryOnce(prisma, identity, "c".repeat(64)),
    ).toBe(false);
  });
  it("leaves authorization revocation for reconciliation before any GitHub request", async () => {
    const identity = {
      appIdentityHash: client.appIdentityHash,
      deliveryGuid: "authorization-reconciliation",
      githubDeliveryId: 42n,
      eventName: "github_app_authorization",
      action: "revoked",
      installationId: null,
      payloadHash: verified.payloadHash,
    };
    const claim = await beginFencedWebhookDelivery(prisma, {
      deliveryId: identity.deliveryGuid, eventName: identity.eventName,
      action: identity.action, payloadHash: identity.payloadHash,
    }, "b".repeat(64), 10000, identity.appIdentityHash, verified.signatureHash);
    await failWebhookFencedDelivery(prisma, claim, "synthetic_failure");
    await prepareWebhookRecovery(prisma, identity);
    const before = calls;
    const authority = new GitHubAppWebhookRecoveryAuthority(prisma, client);
    expect(await authority.authorize(identity)).toBe(false);
    expect(calls).toBe(before);
    expect(await reserveWebhookRedeliveryOnce(prisma, identity, "c".repeat(64))).toBe(false);
    expect((await prepareWebhookRecovery(prisma, identity)).state).toBe("prepared");
  });

  it("runs scoped synthetic POST once and confirms only receiver terminal", async () => {
    const identity = {
      appIdentityHash: client.appIdentityHash,
      deliveryGuid: "synthetic-next",
      githubDeliveryId: 42n,
      eventName: "push",
      action: "push",
      installationId: 123n,
      payloadHash: verified.payloadHash,
    };
    guid = identity.deliveryGuid;
    const claim = await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: identity.deliveryGuid,
        eventName: identity.eventName,
        action: identity.action,
        installationId: "123",
        payloadHash: identity.payloadHash,
      },
      "b".repeat(64),
      10000,
      identity.appIdentityHash,
      verified.signatureHash,
    );
    await failWebhookFencedDelivery(prisma, claim, "synthetic_failure");
    await prepareWebhookRecovery(prisma, identity);
    const custody = {
      reserve: (value: typeof identity, attempt: string) =>
        reserveWebhookRedeliveryOnce(prisma, value, attempt),
      accepted: (value: typeof identity, attempt: string) =>
        recordWebhookRedeliveryAccepted(prisma, value, attempt),
    };
    const authority = new GitHubAppWebhookRecoveryAuthority(prisma, client);
    const before = posts;
    const result = await Promise.all([
      requestWebhookRedeliveryOnce(identity, { client, custody, authority }),
      requestWebhookRedeliveryOnce(identity, { client, custody, authority }),
    ]);
    expect(result.sort()).toEqual(["accepted_unconfirmed", "not_reserved"]);
    expect(posts - before).toBe(1);
    const confirm = {
      confirm: (value: typeof identity) =>
        confirmWebhookRecovery(prisma, value),
    };
    expect(
      (
        await pollWebhookRecovery(
          identity,
          { client, custody: confirm },
          { maxPolls: 1, maxPages: 1, delayMs: 0 },
        )
      ).state,
    ).toBe("pending");
    await completeFailed(identity);
    expect(
      (
        await pollWebhookRecovery(
          identity,
          { client, custody: confirm },
          { maxPolls: 1, maxPages: 1, delayMs: 0 },
        )
      ).state,
    ).toBe("confirmed");
  });
});
