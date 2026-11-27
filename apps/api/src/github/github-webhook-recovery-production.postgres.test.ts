import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimVerifiedFencedWebhookDelivery,
  createGitHubAppWebhookVerifier,
  failWebhookFencedDelivery,
  registerGitHubWebhookRoutes,
} from "@reviewrouter/features-github-installations";
import {
  assertWebhookFenceTestDatabase,
  webhookFencePostgres,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { createDefaultGitHubWebhookDependencies } from "./github-webhook-composition.js";
import { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client.js";
import {
  runKnownWebhookRecovery,
  type WebhookRecoveryCommand,
} from "./github-webhook-recovery.js";

type Delivery = {
  id: bigint;
  guid: string;
  raw: string;
  signature: string;
  metadataSignature: string;
  metadataGuid: string;
  behavior:
    | "deliver"
    | "lost_after_delivery"
    | "lost_before_delivery"
    | "accept_without_delivery";
  posts: number;
  observed: boolean;
};
const test = webhookFencePostgres.enabled ? describe : describe.skip;

test("known delivery recovery through the production receiver and migrated PostgreSQL", () => {
  const pool = new Pool(webhookFencePostgres.connection);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const secret = "synthetic-recovery-secret";
  const appId = "1027";
  const app = Fastify({ logger: false });
  const deliveries = new Map<bigint, Delivery>();
  const verify = createGitHubAppWebhookVerifier({
    appId,
    apiBaseUrl: "https://api.github.com",
    webhookSecret: secret,
  });
  let nextId = 70_000n;
  let receiverOrigin = "";
  let githubOrigin = "";
  let githubReads = 0;
  let receiverStatus = 0;

  async function sendReceiver(delivery: Delivery) {
    const response = await fetch(`${receiverOrigin}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": delivery.guid,
        "x-hub-signature-256": delivery.signature,
      },
      body: delivery.raw,
    });
    await response.text();
    receiverStatus = response.status;
    return response.status;
  }

  async function handleGitHub(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const url = new URL(request.url ?? "/", "http://synthetic");
    if (request.headers.authorization !== "Bearer synthetic-app-jwt")
      throw new Error("synthetic_app_jwt_required");
    const match = url.pathname.match(
      /^\/app\/hook\/deliveries\/([1-9][0-9]*)(\/attempts)?$/u,
    );
    if (request.method === "POST" && match?.[2] === "/attempts") {
      const delivery = deliveries.get(BigInt(match[1]!));
      if (!delivery) {
        response.writeHead(404).end();
        return;
      }
      delivery.posts++;
      delivery.observed = true;
      if (
        delivery.behavior === "deliver" ||
        delivery.behavior === "lost_after_delivery"
      )
        await sendReceiver(delivery);
      if (
        delivery.behavior === "lost_after_delivery" ||
        delivery.behavior === "lost_before_delivery"
      ) {
        response.destroy();
        return;
      }
      response.writeHead(202).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    githubReads++;
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/app/hook/deliveries") {
      // GitHub's HTTP status is deliberately not trusted as receiver completion.
      response.end(
        JSON.stringify(
          [...deliveries.values()]
            .filter((value) => value.observed)
            .map((value) => ({
              id: Number(value.id) + 100_000,
              guid: value.guid,
              event: "push",
              action: null,
              installation_id: 501,
              redelivery: true,
              status_code: 200,
            })),
        ),
      );
      return;
    }
    const delivery = match && deliveries.get(BigInt(match[1]!));
    if (!delivery) {
      response.writeHead(404).end();
      return;
    }
    response.end(
      JSON.stringify({
        id: Number(delivery.id),
        guid: delivery.metadataGuid,
        event: "push",
        action: null,
        installation_id: 501,
        request: {
          headers: { "X-Hub-Signature-256": delivery.metadataSignature },
        },
      }),
    );
  }
  const github = createServer((request, response) => {
    void handleGitHub(request, response).catch(() => {
      response.writeHead(500).end();
    });
  });

  function client(app = appId) {
    return GitHubAppWebhookRedeliveryClient.forSyntheticTest(
      app,
      async () => "synthetic-app-jwt",
      async (resource, options) => {
        const url = new URL(String(resource));
        if (url.origin !== "https://api.github.com")
          throw new Error("unexpected_github_origin");
        return fetch(`${githubOrigin}${url.pathname}${url.search}`, options);
      },
    );
  }
  const command = (
    delivery: Delivery,
    mode: WebhookRecoveryCommand["mode"],
  ): WebhookRecoveryCommand => ({
    mode,
    deliveryGuid: delivery.guid,
    githubDeliveryId: delivery.id,
  });
  const run = (delivery: Delivery, mode: WebhookRecoveryCommand["mode"]) =>
    runKnownWebhookRecovery(command(delivery, mode), {
      prisma,
      client: client(),
    });
  const receipt = (delivery: Delivery) =>
    prisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: { deliveryId: delivery.guid },
    });
  const intent = (delivery: Delivery) =>
    prisma.gitHubWebhookRecoveryIntent.findUnique({
      where: {
        appIdentityHash_deliveryGuid: {
          appIdentityHash: client().appIdentityHash,
          deliveryGuid: delivery.guid,
        },
      },
    });
  const outboxCount = (delivery: Delivery) =>
    prisma.outboxEvent.count({
      where: {
        idempotencyKey: `conflict-review:detect:delivery:${delivery.guid}`,
      },
    });

  async function failedDelivery(
    behavior: Delivery["behavior"] = "deliver",
  ): Promise<Delivery> {
    const guid = `recovery-http-${randomUUID()}`;
    const raw = JSON.stringify({
      ref: "refs/heads/main",
      deleted: false,
      installation: { id: 501 },
      repository: { id: 601, name: "recovery", full_name: "fixture/recovery" },
    });
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const verified = verify({
      rawPayload: Buffer.from(raw),
      signatureHeader: signature,
    });
    if (!verified) throw new Error("synthetic_signature_invalid");
    const acquisition = await claimVerifiedFencedWebhookDelivery(
      prisma,
      verified,
      {
        deliveryId: guid,
        eventName: "push",
        action: "push",
        installationId: "501",
        payloadHash: verified.payloadHash,
        normalizedEvent: {
          type: "github.push",
          version: 1,
          installationId: "501",
          repositoryId: "601",
          repositoryFullName: "fixture/recovery",
          ref: "refs/heads/main",
          deleted: false,
        },
      },
      randomBytes(32).toString("hex"),
      30_000,
    );
    if (acquisition.kind !== "claimed")
      throw new Error("synthetic_claim_missing");
    expect(
      await failWebhookFencedDelivery(
        prisma,
        acquisition.claim,
        "synthetic_stopped_handler",
      ),
    ).toBe(true);
    const delivery: Delivery = {
      id: nextId++,
      guid,
      raw,
      signature,
      metadataSignature: signature,
      metadataGuid: guid,
      behavior,
      posts: 0,
      observed: false,
    };
    deliveries.set(delivery.id, delivery);
    return delivery;
  }

  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
    const migrations = await pool.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    expect(migrations.rows.map((row) => row.migration_name)).toEqual(
      expect.arrayContaining([
        "000165_webhook_effect_fence",
        "000167_webhook_recovery_intent",
      ]),
    );
    expect(migrations.rows.length).toBeGreaterThanOrEqual(172);
    await registerGitHubWebhookRoutes(
      app,
      createDefaultGitHubWebhookDependencies({
        prisma,
        webhookSecret: secret,
        env: {
          GITHUB_APP_ID: appId,
          REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK: "1",
        },
      }),
    );
    receiverOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) =>
      github.listen(0, "127.0.0.1", resolve),
    );
    githubOrigin = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    if (github.listening)
      await new Promise<void>((resolve, reject) =>
        github.close((error) => (error ? reject(error) : resolve())),
      );
    await prisma.$disconnect();
    await pool.end();
    // The runner owns this disposable database; protected receipts are never deleted here.
  });

  it("inspects read-only, then requests once and confirms the actual HTTP receiver and outbox", async () => {
    const delivery = await failedDelivery();
    expect(await run(delivery, "inspect")).toMatchObject({
      state: "eligible",
      deliveryStatus: "failed",
      recoveryState: null,
    });
    expect(delivery.posts).toBe(0);
    expect(await intent(delivery)).toBeNull();
    expect(await outboxCount(delivery)).toBe(0);
    expect(await run(delivery, "request")).toMatchObject({
      state: "confirmed",
      deliveryStatus: "processed",
      recoveryState: "confirmed",
      requestOutcome: "accepted_unconfirmed",
    });
    expect(receiverStatus).toBe(200);
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(1);
    expect((await receipt(delivery)).status).toBe("processed");
    expect(await run(delivery, "request")).toMatchObject({
      state: "confirmed",
    });
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "confirmed",
    });
    expect(delivery.posts).toBe(1);
  });

  it("reconciles a lost POST response from the committed receiver without another POST", async () => {
    const delivery = await failedDelivery("lost_after_delivery");
    expect(await run(delivery, "request")).toMatchObject({
      state: "confirmed",
      requestOutcome: "unknown",
      recoveryState: "confirmed",
      deliveryStatus: "processed",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(1);
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "confirmed",
    });
    expect(delivery.posts).toBe(1);
  });

  it("keeps an unknown outcome durable across fresh invocations and confirms only a later receiver delivery", async () => {
    const delivery = await failedDelivery("lost_before_delivery");
    expect(await run(delivery, "request")).toMatchObject({
      state: "pending",
      requestOutcome: "unknown",
      recoveryState: "issued_unknown",
      deliveryStatus: "failed",
    });
    expect(await run(delivery, "inspect")).toMatchObject({
      state: "reconciliation_required",
      recoveryState: "issued_unknown",
    });
    expect(await run(delivery, "request")).toMatchObject({
      state: "pending",
      requestOutcome: "not_reserved",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(0);
    expect(await sendReceiver(delivery)).toBe(200);
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "confirmed",
      recoveryState: "confirmed",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(1);
  });

  it("does not report accepted POST or observed HTTP 200 metadata as successful receiver processing", async () => {
    const delivery = await failedDelivery("accept_without_delivery");
    expect(await run(delivery, "request")).toMatchObject({
      state: "pending",
      requestOutcome: "accepted_unconfirmed",
      deliveryStatus: "failed",
      recoveryState: "accepted",
    });
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "pending",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(0);
  });

  it("serializes concurrent operators into one POST and one durable effect", async () => {
    const delivery = await failedDelivery();
    const outcomes = await Promise.all([
      run(delivery, "request"),
      run(delivery, "request"),
      run(delivery, "request"),
    ]);
    expect(
      outcomes.every((result) =>
        ["confirmed", "processed", "pending"].includes(result.state),
      ),
    ).toBe(true);
    expect(outcomes.some((result) => result.state === "confirmed")).toBe(true);
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "confirmed",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(1);
  });

  it.each(["signature", "guid"] as const)(
    "rejects mismatched GitHub %s before custody or POST",
    async (field) => {
      const delivery = await failedDelivery();
      if (field === "signature")
        delivery.metadataSignature = `sha256=${"f".repeat(64)}`;
      else delivery.metadataGuid = "unrelated-guid";
      expect(await run(delivery, "inspect")).toMatchObject({
        state: "not_authorized",
      });
      expect(await run(delivery, "request")).toMatchObject({
        state: "not_authorized",
      });
      expect(delivery.posts).toBe(0);
      expect(await intent(delivery)).toBeNull();
      expect(await outboxCount(delivery)).toBe(0);
    },
  );

  it("rejects wrong App, unknown receipts and a different numeric ID for existing custody", async () => {
    const delivery = await failedDelivery("accept_without_delivery");
    const reads = githubReads;
    await expect(
      runKnownWebhookRecovery(command(delivery, "request"), {
        prisma,
        client: client("1028"),
      }),
    ).rejects.toThrow("webhook_recovery_app_identity_mismatch");
    await expect(
      runKnownWebhookRecovery(
        {
          ...command(delivery, "request"),
          deliveryGuid: `missing-${randomUUID()}`,
        },
        { prisma, client: client() },
      ),
    ).rejects.toThrow("webhook_recovery_delivery_not_found");
    expect(githubReads).toBe(reads);
    expect(delivery.posts).toBe(0);
    expect(await run(delivery, "request")).toMatchObject({ state: "pending" });
    await expect(
      runKnownWebhookRecovery(
        {
          ...command(delivery, "request"),
          githubDeliveryId: delivery.id + 1n,
        },
        { prisma, client: client() },
      ),
    ).rejects.toThrow("webhook_recovery_identity_conflict");
    expect(delivery.posts).toBe(1);
  });

  it("reports a processed local receipt without claiming an unverified numeric delivery binding", async () => {
    const delivery = await failedDelivery();
    expect(await sendReceiver(delivery)).toBe(200);
    const reads = githubReads;
    expect(await run(delivery, "inspect")).toMatchObject({
      state: "processed",
      recoveryState: null,
      githubDeliveryIdBound: false,
    });
    expect(await run(delivery, "request")).toMatchObject({
      state: "processed",
      recoveryState: null,
      githubDeliveryIdBound: false,
    });
    expect(githubReads).toBe(reads);
    expect(delivery.posts).toBe(0);
    expect(await intent(delivery)).toBeNull();
    expect(await outboxCount(delivery)).toBe(1);
  });

  it("keeps reconcile without custody read-only and refuses unfenced legacy receipts", async () => {
    const delivery = await failedDelivery();
    const reads = githubReads;
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "not_requested",
      recoveryState: null,
    });
    expect(await intent(delivery)).toBeNull();
    expect(githubReads).toBe(reads);
    const legacyGuid = `legacy-recovery-${randomUUID()}`;
    await prisma.gitHubWebhookDelivery.create({
      data: {
        deliveryId: legacyGuid,
        eventName: "push",
        action: "push",
        installationId: 501n,
        payloadHash: "a".repeat(64),
        status: "failed",
      },
    });
    await expect(
      runKnownWebhookRecovery(
        {
          ...command(delivery, "request"),
          deliveryGuid: legacyGuid,
        },
        { prisma, client: client() },
      ),
    ).rejects.toThrow("webhook_recovery_authenticated_fence_required");
    expect(delivery.posts).toBe(0);
    expect(githubReads).toBe(reads);
  });
});
