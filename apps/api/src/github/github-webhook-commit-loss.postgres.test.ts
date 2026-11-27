import { createHash, createHmac, randomUUID } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import {
  failWebhookFencedDelivery,
  registerGitHubWebhookRoutes,
} from "@reviewrouter/features-github-installations";
import {
  assertWebhookFenceTestDatabase,
  webhookFencePostgres,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { createDefaultGitHubWebhookDependencies } from "./github-webhook-composition.js";

const test = webhookFencePostgres.enabled ? describe : describe.skip;

test("native PostgreSQL COMMIT acknowledgement loss", () => {
  it("retains the committed receipt and outbox when the receiver loses the COMMIT response", async () => {
    const directPool = new Pool({
      ...webhookFencePostgres.connection,
      connectionTimeoutMillis: 2_000,
      query_timeout: 5_000,
    });
    const direct = new PrismaClient({ adapter: new PrismaPg(directPool) });
    const app = Fastify({ logger: false, forceCloseConnections: true });
    let proxy: Awaited<ReturnType<typeof commitLossProxy>> | undefined;
    let receiverPool: Pool | undefined;
    let receiver: PrismaClient | undefined;
    const failures: unknown[] = [];
    const recordFailure = (error: unknown) => {
      failures.push(error);
    };
    try {
      await assertWebhookFenceTestDatabase(directPool);
      proxy = await commitLossProxy(webhookFencePostgres.connection);
      receiverPool = new Pool({
        ...proxy.connection,
        max: 1,
        connectionTimeoutMillis: 2_000,
        query_timeout: 5_000,
      });
      receiver = new PrismaClient({ adapter: new PrismaPg(receiverPool) });
      const secret = "synthetic-commit-loss-secret";
      await registerGitHubWebhookRoutes(
        app,
        createDefaultGitHubWebhookDependencies({
          prisma: receiver,
          webhookSecret: secret,
          env: {
            GITHUB_APP_ID: "1027",
            REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK: "1",
          },
        }),
      );
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const deliveryId = `commit-loss-${randomUUID()}`;
      const body = JSON.stringify({
        installation: { id: 90701 },
        repository: {
          id: 90702,
          name: "commit-loss",
          full_name: "fixture/commit-loss",
        },
        ref: "refs/heads/main",
        deleted: false,
      });
      const send = async () => {
        const response = await fetch(`${origin}/webhooks/github`, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(10_000),
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-github-delivery": deliveryId,
            "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
          },
        });
        const result: unknown = await response.json();
        return { status: response.status, body: result };
      };
      // The first explicit transaction persists the claim. The second commits
      // the effect and terminal receipt. The dedicated pool has no other caller.
      proxy.dropSecondCommit();
      expect((await send()).status).toBe(500);
      expect(proxy.observation()).toEqual({ dropped: 1, invalidFrames: 0 });

      // This connection bypasses the relay: database state is the independent
      // oracle, not a simulated successful transaction or thrown wrapper error.
      const receipt = await direct.gitHubWebhookDelivery.findUniqueOrThrow({
        where: { deliveryId },
      });
      const fence = await direct.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      });
      const outbox = () =>
        direct.outboxEvent.count({
          where: {
            idempotencyKey: `conflict-review:detect:delivery:${deliveryId}`,
          },
        });
      expect(receipt).toMatchObject({
        status: "processed",
        errorSummary: null,
        eventName: "push",
        action: "push",
        installationId: 90701n,
        payloadHash: createHash("sha256").update(body).digest("hex"),
      });
      expect(fence.generation).toBe(1n);
      expect(await outbox()).toBe(1);
      expect(
        await failWebhookFencedDelivery(
          direct,
          {
            deliveryId,
            ownerHash: fence.ownerHash,
            appIdentityHash: fence.appIdentityHash,
            generation: fence.generation,
          },
          "late_failure_after_lost_commit_ack",
        ),
      ).toBe(false);

      expect(await send()).toEqual({ status: 200, body: { processed: false } });
      expect(await outbox()).toBe(1);
      expect(
        (
          await direct.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId },
          })
        ).status,
      ).toBe("processed");
      expect(
        (
          await direct.gitHubWebhookFence.findUniqueOrThrow({
            where: { deliveryId },
          })
        ).generation,
      ).toBe(1n);
      expect(proxy.observation()).toEqual({ dropped: 1, invalidFrames: 0 });
    } catch (error) {
      recordFailure(error);
    } finally {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const cleanup = Promise.allSettled([
          app.close(),
          (async () => {
            await receiver?.$disconnect().catch(recordFailure);
            await receiverPool?.end().catch(recordFailure);
          })(),
          (async () => {
            await direct.$disconnect().catch(recordFailure);
            await directPool.end().catch(recordFailure);
          })(),
        ]);
        const completed = await Promise.race([
          cleanup,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("commit_loss_fixture_cleanup_timeout")),
              5_000,
            );
          }),
        ]);
        for (const result of completed) {
          if (result.status === "rejected") recordFailure(result.reason);
        }
      } catch (error) {
        recordFailure(error);
      } finally {
        clearTimeout(timer);
        try {
          await proxy?.close();
        } catch (error) {
          recordFailure(error);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "commit_loss_fixture_failed", {
        cause: failures[0],
      });
  }, 20_000);
});

/** Only this explicit local fixture, unencrypted PostgreSQL protocol, one fault. */
async function commitLossProxy(connection: PoolConfig) {
  const url = connection.connectionString
    ? new URL(connection.connectionString)
    : null;
  const host = (url?.hostname ?? connection.host ?? "127.0.0.1").replace(
    /^\[|\]$/gu,
    "",
  );
  const port = Number(
    url?.port || connection.port || process.env.PGPORT || 5432,
  );
  const target = host.startsWith("/")
    ? { path: `${host}/.s.PGSQL.${port}` }
    : { host, port };
  const sockets = new Set<Socket>();
  const commitTag = Buffer.from("COMMIT\0");
  let remaining = 0,
    dropped = 0,
    invalidFrames = 0;
  const server = createServer((frontend) => {
    const backend = createConnection(target);
    for (const socket of [frontend, backend]) {
      sockets.add(socket);
      socket.setNoDelay(true);
      socket.on("error", () => {
        frontend.destroy();
        backend.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        frontend.destroy();
        backend.destroy();
      });
    }
    // Authentication, SQL and parameters reach the real server unchanged.
    frontend.pipe(backend);
    let pending: Buffer = Buffer.alloc(0);
    backend.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5) {
        const length = pending.readInt32BE(1);
        if (length < 4 || length > 1_048_576) {
          invalidFrames++;
          frontend.destroy();
          backend.destroy();
          return;
        }
        if (pending.length < length + 1) return;
        const message = pending.subarray(0, length + 1);
        pending = pending.subarray(length + 1);
        // PostgreSQL backend CommandComplete: Byte1('C'), Int32, tag + NUL.
        // Buffer complete frames, so even a fragmented COMMIT acknowledgement
        // is withheld before any byte of it can reach node-postgres/Prisma.
        if (
          remaining > 0 &&
          message[0] === 67 &&
          message.subarray(5).equals(commitTag) &&
          --remaining === 0
        ) {
          dropped++;
          frontend.destroy();
          backend.destroy();
          return;
        }
        frontend.write(message);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("commit_loss_proxy_address_invalid");
  if (url) {
    url.hostname = "127.0.0.1";
    url.port = String(address.port);
  }
  return {
    connection: {
      ...connection,
      host: "127.0.0.1",
      port: address.port,
      ssl: false,
      ...(url ? { connectionString: url.toString() } : {}),
    },
    dropSecondCommit() {
      remaining = 2;
    },
    observation: () => ({ dropped, invalidFrames }),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
