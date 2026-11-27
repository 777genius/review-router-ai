import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  claimVerifiedFencedWebhookDelivery,
  createGitHubAppWebhookVerifier,
  failWebhookFencedDelivery,
  registerGitHubWebhookRoutes,
  type FencedDelivery,
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
  eventName: "push" | "installation";
  action: "suspend" | "unsuspend" | null;
  installationId: number;
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
  const detailGates = new Map<
    bigint,
    { entered: boolean; released: Promise<void> }
  >();
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
        "x-github-event": delivery.eventName,
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
              event: value.eventName,
              action: value.action,
              installation_id: value.installationId,
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
    const gate = detailGates.get(delivery.id);
    if (gate) {
      detailGates.delete(delivery.id);
      gate.entered = true;
      await gate.released;
    }
    response.end(
      JSON.stringify({
        id: Number(delivery.id),
        guid: delivery.metadataGuid,
        event: delivery.eventName,
        action: delivery.action,
        installation_id: delivery.installationId,
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

  async function claimDelivery(delivery: Delivery) {
    const verified = verify({
      rawPayload: Buffer.from(delivery.raw),
      signatureHeader: delivery.signature,
    });
    if (!verified) throw new Error("synthetic_signature_invalid");
    return claimVerifiedFencedWebhookDelivery(
      prisma,
      verified,
      {
        deliveryId: delivery.guid,
        eventName: delivery.eventName,
        action: delivery.action ?? "push",
        installationId: String(delivery.installationId),
        payloadHash: verified.payloadHash,
        normalizedEvent:
          delivery.eventName === "push"
            ? {
                type: "github.push",
                version: 1,
                installationId: String(delivery.installationId),
                repositoryId: "601",
                repositoryFullName: "fixture/recovery",
                ref: "refs/heads/main",
                deleted: false,
              }
            : {
                type: "github.installation",
                version: 1,
                action: delivery.action,
                installationId: String(delivery.installationId),
                accountLogin: "fixture",
                accountType: "User",
                repositorySelection: "all",
              },
      },
      randomBytes(32).toString("hex"),
      30_000,
    );
  }

  async function failedDelivery(
    behavior: Delivery["behavior"] = "deliver",
    lifecycle?: { installationId: number; action: "suspend" | "unsuspend" },
  ): Promise<Delivery> {
    const guid = `recovery-http-${randomUUID()}`;
    const raw = JSON.stringify(
      lifecycle
        ? {
            action: lifecycle.action,
            installation: {
              id: lifecycle.installationId,
              account: { login: "fixture", type: "User" },
              repository_selection: "all",
            },
          }
        : {
            ref: "refs/heads/main",
            deleted: false,
            installation: { id: 501 },
            repository: {
              id: 601,
              name: "recovery",
              full_name: "fixture/recovery",
            },
          },
    );
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const delivery: Delivery = {
      id: nextId++,
      guid,
      raw,
      signature,
      metadataSignature: signature,
      metadataGuid: guid,
      eventName: lifecycle ? "installation" : "push",
      action: lifecycle?.action ?? null,
      installationId: lifecycle?.installationId ?? 501,
      behavior,
      posts: 0,
      observed: false,
    };
    const acquisition = await claimDelivery(delivery);
    if (acquisition.kind !== "claimed")
      throw new Error("synthetic_claim_missing");
    expect(
      await failWebhookFencedDelivery(
        prisma,
        acquisition.claim,
        "synthetic_stopped_handler",
      ),
    ).toBe(true);
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

  it.each([
    ["lost_before_delivery", "issued_unknown", "reconciliation_required"],
    ["accept_without_delivery", "accepted", "reconciliation_required"],
    ["deliver", "confirmed", "processed"],
  ] as const)(
    "refreshes inspect after a concurrent %s request while authorization is in flight",
    async (behavior, recoveryState, state) => {
      const delivery = await failedDelivery(behavior);
      let release!: () => void;
      const gate = {
        entered: false,
        released: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      detailGates.set(delivery.id, gate);
      const inspected = run(delivery, "inspect").then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const failures: unknown[] = [];
      try {
        await expect.poll(() => gate.entered, { timeout: 3_000 }).toBe(true);
        expect(await run(delivery, "request")).toMatchObject({ recoveryState });
        release();
        const outcome = await inspected;
        if ("error" in outcome) throw outcome.error;
        expect(outcome.value).toMatchObject({
          state,
          recoveryState,
          githubDeliveryIdBound: true,
        });
        expect(delivery.posts).toBe(1);
      } catch (error) {
        failures.push(error);
      } finally {
        release();
        detailGates.delete(delivery.id);
        const outcome = await inspected;
        if ("error" in outcome && !failures.includes(outcome.error))
          failures.push(outcome.error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "inspection_race_failed", {
          cause: failures[0],
        });
    },
    15_000,
  );

  it.each(["lease_takeover", "newer_receipt"] as const)(
    "refreshes local eligibility after %s during the detail request",
    async (change) => {
      const lifecycle =
        change === "newer_receipt"
          ? {
              installationId: Number(nextId) + 900_000,
              action: "suspend" as const,
            }
          : undefined;
      const delivery = await failedDelivery(
        "accept_without_delivery",
        lifecycle,
      );
      const reads = githubReads;
      let release!: () => void;
      const gate = {
        entered: false,
        released: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      detailGates.set(delivery.id, gate);
      const inspected = run(delivery, "inspect").then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      let ownedClaim: FencedDelivery | undefined;
      const failures: unknown[] = [];
      try {
        await expect.poll(() => gate.entered, { timeout: 3_000 }).toBe(true);
        if (change === "lease_takeover") {
          const takeover = await claimDelivery(delivery);
          if (takeover.kind !== "claimed")
            throw new Error("inspection_takeover_not_claimed");
          ownedClaim = takeover.claim;
          expect(takeover.claim.generation).toBe(2n);
        } else {
          await failedDelivery("accept_without_delivery", {
            installationId: delivery.installationId,
            action: "unsuspend",
          });
        }
        release();
        const outcome = await inspected;
        if ("error" in outcome) throw outcome.error;
        expect(outcome.value).toMatchObject({
          state: "not_authorized",
          deliveryStatus: change === "lease_takeover" ? "processing" : "failed",
          recoveryState: null,
        });
        expect(githubReads).toBe(reads + 1);
        expect(delivery.posts).toBe(0);
        expect(await intent(delivery)).toBeNull();
      } catch (error) {
        failures.push(error);
      } finally {
        release();
        detailGates.delete(delivery.id);
        const outcome = await inspected;
        if ("error" in outcome && !failures.includes(outcome.error))
          failures.push(outcome.error);
        if (ownedClaim)
          await failWebhookFencedDelivery(
            prisma,
            ownedClaim,
            "synthetic_inspect_cleanup",
          ).catch((error: unknown) => {
            failures.push(error);
          });
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          "inspection_eligibility_race_failed",
          { cause: failures[0] },
        );
    },
    15_000,
  );

  it("keeps the final receipt and eligibility reads in one snapshot across a takeover", async () => {
    const delivery = await failedDelivery();
    const isolated = new PrismaClient({ adapter: new PrismaPg(pool) });
    const failures: unknown[] = [];
    let ownedClaim: FencedDelivery | undefined;
    let snapshotReads = 0;
    let restoreTransaction: (() => void) | undefined;
    try {
      const gated = isolated.$extends({
        query: {
          async $queryRaw({ args, query }) {
            const result: unknown = await query(args);
            if (
              args.sql.includes('r.state AS "recoveryState"') &&
              args.values.includes(delivery.guid)
            ) {
              snapshotReads++;
              // A separate connection commits after the snapshot's first read,
              // before the transaction checks its lease and replay predicates.
              const takeover = await claimDelivery(delivery);
              if (takeover.kind !== "claimed")
                throw new Error("snapshot_takeover_not_claimed");
              ownedClaim = takeover.claim;
            }
            return result;
          },
        },
      });
      // Preserve native queries and results, adding only the scheduling barrier.
      const nativeTransaction = gated.$transaction.bind(gated);
      const transactionSpy = vi
        .spyOn(isolated, "$transaction")
        .mockImplementation((callback, options) =>
          nativeTransaction(
            // This query-only extension preserves the transaction client shape;
            // Prisma's extension type also rewrites unused nested overloads.
            (transaction) => callback(transaction as Prisma.TransactionClient),
            options,
          ),
        );
      restoreTransaction = () => transactionSpy.mockRestore();
      expect(
        await runKnownWebhookRecovery(command(delivery, "inspect"), {
          prisma: isolated,
          client: client(),
        }),
      ).toMatchObject({
        state: "eligible",
        deliveryStatus: "failed",
        recoveryState: null,
      });
      expect(snapshotReads).toBe(1);
      expect((await receipt(delivery)).status).toBe("processing");
      expect(await run(delivery, "inspect")).toMatchObject({
        state: "not_authorized",
        deliveryStatus: "processing",
        recoveryState: null,
      });
      expect(delivery.posts).toBe(0);
      expect(await intent(delivery)).toBeNull();
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        restoreTransaction?.();
      } catch (error) {
        failures.push(error);
      }
      if (ownedClaim)
        await failWebhookFencedDelivery(
          prisma,
          ownedClaim,
          "synthetic_snapshot_cleanup",
        ).catch((error: unknown) => {
          failures.push(error);
        });
      await isolated.$disconnect().catch((error: unknown) => {
        failures.push(error);
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "inspection_snapshot_cleanup_failed", {
        cause: failures[0],
      });
  });

  it("bounds a blocked confirmation and later reconciles retained custody without another POST", async () => {
    const delivery = await failedDelivery("accept_without_delivery");
    expect(await run(delivery, "request")).toMatchObject({
      recoveryState: "accepted",
    });
    expect(await sendReceiver(delivery)).toBe(200);
    const before = await intent(delivery);
    const reads = githubReads;
    const isolatedPool = new Pool({
      ...webhookFencePostgres.connection,
      max: 1,
    });
    const isolated = new PrismaClient({ adapter: new PrismaPg(isolatedPool) });
    const blocker = await pool.connect();
    const failures: unknown[] = [];
    let locked = false;
    let pending:
      | Promise<
          | { value: Awaited<ReturnType<typeof runKnownWebhookRecovery>> }
          | { error: unknown }
        >
      | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await isolated.$executeRaw`SET statement_timeout = 0`;
      await isolated.$executeRaw`SET lock_timeout = 0`;
      const initialTimeout = await isolated.$queryRaw<
        Array<{ statement_timeout: string; lock_timeout: string }>
      >`SELECT current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout`;
      expect(initialTimeout).toEqual([
        { statement_timeout: "0", lock_timeout: "0" },
      ]);
      const waiter = await isolated.$queryRaw<
        Array<{ pid: number }>
      >`SELECT pg_backend_pid() AS pid`;
      if (!waiter[0]) throw new Error("confirmation_backend_missing");
      await blocker.query("BEGIN");
      locked = true;
      const blockerPid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      if (!blockerPid.rows[0]) throw new Error("confirmation_blocker_missing");
      await blocker.query(
        'SELECT "deliveryGuid" FROM "GitHubWebhookRecoveryIntent" WHERE "deliveryGuid"=$1 FOR UPDATE',
        [delivery.guid],
      );
      pending = runKnownWebhookRecovery(command(delivery, "reconcile"), {
        prisma: isolated,
        client: client(),
      }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("confirmation_sql_deadline_missing")),
          10_000,
        );
      });
      const bounded = Promise.race([pending, deadline]).catch(
        (error: unknown) => ({ error }),
      );
      await expect
        .poll(
          async () => {
            const result = await pool.query<{ blocked: boolean }>(
              "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked",
              [blockerPid.rows[0]!.pid, waiter[0]!.pid],
            );
            return result.rows[0]?.blocked;
          },
          { timeout: 3_000, interval: 10 },
        )
        .toBe(true);
      const outcome = await bounded;
      if ("error" in outcome) throw outcome.error;
      expect(outcome.value).toMatchObject({
        state: "incomplete",
        recoveryState: "accepted",
        deliveryStatus: "processed",
        polls: 0,
      });
      expect(await intent(delivery)).toEqual(before);
      expect(githubReads).toBe(reads);
      expect(
        await isolated.$queryRaw`SELECT current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout`,
      ).toEqual(initialTimeout);
      await blocker.query("COMMIT");
      locked = false;
      expect(await run(delivery, "reconcile")).toMatchObject({
        state: "confirmed",
        recoveryState: "confirmed",
      });
      expect(delivery.posts).toBe(1);
      expect(await outboxCount(delivery)).toBe(1);
    } catch (error) {
      failures.push(error);
    } finally {
      if (locked)
        await blocker.query("ROLLBACK").catch((error: unknown) => {
          failures.push(error);
        });
      blocker.release();
      const outcome = await pending;
      if (outcome && "error" in outcome && !failures.includes(outcome.error))
        failures.push(outcome.error);
      if (timer) clearTimeout(timer);
      await isolated.$disconnect().catch((error: unknown) => {
        failures.push(error);
      });
      await isolatedPool.end().catch((error: unknown) => {
        failures.push(error);
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "confirmation_lock_cleanup_failed", {
        cause: failures[0],
      });
  }, 20_000);

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
    for (const outcome of outcomes) {
      if (outcome.recoveryState === "confirmed")
        expect(outcome.state).toBe("confirmed");
    }
    expect(await run(delivery, "reconcile")).toMatchObject({
      state: "confirmed",
    });
    expect(delivery.posts).toBe(1);
    expect(await outboxCount(delivery)).toBe(1);
  });

  it("reports confirmation committed by a peer after the last pending poll", async () => {
    const delivery = await failedDelivery("accept_without_delivery");
    expect(await run(delivery, "request")).toMatchObject({
      state: "pending",
      recoveryState: "accepted",
    });
    const isolated = new PrismaClient({ adapter: new PrismaPg(pool) });
    const failures: unknown[] = [];
    try {
      let emptyConfirmations = 0;
      let lateReceiverStatus: number | undefined;
      let peer: Awaited<ReturnType<typeof runKnownWebhookRecovery>> | undefined;
      const gated = isolated.$extends({
        query: {
          async $queryRaw({ args, query }) {
            const result: unknown = await query(args);
            if (
              args.sql.includes(
                'UPDATE "GitHubWebhookRecoveryIntent" r SET "state"=\'confirmed\'',
              ) &&
              args.values.includes(delivery.guid)
            ) {
              if (!Array.isArray(result) || result.length !== 0)
                throw new Error("expected_unconfirmed_native_result");
              emptyConfirmations++;
              if (emptyConfirmations === 6) {
                // All three polls saw two real empty confirmation UPDATEs.
                // Keep the last result unchanged while a separate receiver and
                // operator commit confirmation before the final summary read.
                lateReceiverStatus = await sendReceiver(delivery);
                peer = await run(delivery, "reconcile");
              }
            }
            return result;
          },
        },
      });
      // Use a real client and native extension solely as a scheduling barrier.
      // No rows, query arguments or result statuses are substituted.
      isolated.$queryRaw = gated.$queryRaw.bind(gated);
      const result = await runKnownWebhookRecovery(
        command(delivery, "reconcile"),
        { prisma: isolated, client: client() },
      );
      expect(emptyConfirmations).toBe(6);
      expect(lateReceiverStatus).toBe(200);
      expect(peer).toMatchObject({
        state: "confirmed",
        recoveryState: "confirmed",
      });
      expect(result).toMatchObject({
        state: "confirmed",
        recoveryState: "confirmed",
        deliveryStatus: "processed",
        polls: 3,
        observedAttempts: 1,
        requestOutcome: null,
      });
      expect((await intent(delivery))?.state).toBe("confirmed");
      expect((await receipt(delivery)).status).toBe("processed");
      expect(delivery.posts).toBe(1);
      expect(await outboxCount(delivery)).toBe(1);
    } catch (error) {
      failures.push(error);
    } finally {
      await isolated.$disconnect().catch((error: unknown) => {
        failures.push(error);
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "recovery_barrier_cleanup_failed", {
        cause: failures[0],
      });
  }, 15_000);

  it.each(["eventName", "action", "installationId", "payloadHash"] as const)(
    "rejects existing custody with mismatched %s before any remote request",
    async (field) => {
      const delivery = await failedDelivery("accept_without_delivery");
      const stored = await receipt(delivery);
      if (!stored.payloadHash)
        throw new Error("synthetic_payload_hash_missing");
      await prisma.gitHubWebhookRecoveryIntent.create({
        data: {
          appIdentityHash: client().appIdentityHash,
          deliveryGuid: delivery.guid,
          githubDeliveryId: delivery.id,
          eventName: field === "eventName" ? "repository" : stored.eventName,
          action: field === "action" ? null : stored.action,
          installationId:
            field === "installationId" ? null : stored.installationId,
          payloadHash:
            field === "payloadHash" ? "e".repeat(64) : stored.payloadHash,
        },
      });
      const reads = githubReads;
      for (const mode of ["inspect", "request", "reconcile"] as const) {
        await expect(run(delivery, mode)).rejects.toThrow(
          "webhook_recovery_identity_conflict",
        );
      }
      expect(githubReads).toBe(reads);
      expect(delivery.posts).toBe(0);
      expect((await intent(delivery))?.state).toBe("prepared");
      expect(await outboxCount(delivery)).toBe(0);
    },
  );

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
