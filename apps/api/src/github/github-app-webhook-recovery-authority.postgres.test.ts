import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  prepareWebhookRecovery,
  reserveWebhookRedeliveryOnce,
  recordWebhookRedeliveryAccepted,
  confirmWebhookRecovery,
  requestWebhookRedeliveryOnce,
  pollWebhookRecovery,
} from "@reviewrouter/features-github-installations";
import { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";
import { GitHubAppWebhookRecoveryAuthority } from "./github-app-webhook-recovery-authority";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("recovery authority with synthetic GitHub and isolated PostgreSQL", () => {
  const schema = `recovery_authority_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
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
        request: { payload: { synthetic: "never-return" } },
      }),
    );
  });
  let client: GitHubAppWebhookRedeliveryClient;
  beforeAll(async () => {
    if (
      !socket?.startsWith("/") ||
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
        "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
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
  it("requires exact failed receiver evidence and exact GitHub App delivery, then rechecks at reserve", async () => {
    const identity = {
      appIdentityHash: client.appIdentityHash,
      deliveryGuid: "synthetic",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
    const authority = new GitHubAppWebhookRecoveryAuthority(prisma, client);
    expect(await authority.authorize(identity)).toBe(false);
    expect(calls).toBe(0);
    await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: identity.deliveryGuid,
        eventName: identity.eventName,
        action: null,
        installationId: "123",
        payloadHash: identity.payloadHash,
      },
      "b".repeat(64),
      10000,
      identity.appIdentityHash,
    );
    expect(await authority.authorize(identity)).toBe(false);
    expect(calls).toBe(0);
    await pool.query(
      'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
      [identity.deliveryGuid],
    );
    guid = "wrong";
    expect(await authority.authorize(identity)).toBe(false);
    guid = "synthetic";
    expect(await authority.authorize(identity)).toBe(true);
    await prepareWebhookRecovery(prisma, identity);
    await pool.query(
      'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
      [identity.deliveryGuid],
    );
    expect(
      await reserveWebhookRedeliveryOnce(prisma, identity, "c".repeat(64)),
    ).toBe(false);
  });
  it("runs scoped synthetic POST once and confirms only receiver terminal", async () => {
    const identity = {
      appIdentityHash: client.appIdentityHash,
      deliveryGuid: "synthetic-next",
      githubDeliveryId: 42n,
      eventName: "push",
      action: null,
      installationId: 123n,
      payloadHash: "a".repeat(64),
    };
    guid = identity.deliveryGuid;
    await beginFencedWebhookDelivery(
      prisma,
      {
        deliveryId: identity.deliveryGuid,
        eventName: identity.eventName,
        action: null,
        installationId: "123",
        payloadHash: identity.payloadHash,
      },
      "b".repeat(64),
      10000,
      identity.appIdentityHash,
    );
    await pool.query(
      'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
      [identity.deliveryGuid],
    );
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
    await pool.query(
      'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
      [identity.deliveryGuid],
    );
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
