import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "../../../../../scripts/webhook-fencing/postgres-fixture";
import { PrismaWebhookDeliveryRepository } from "../infrastructure/prisma/prisma-webhook-delivery-repository";
import { createHmac, randomBytes } from "node:crypto";
import { createGitHubAppWebhookVerifier } from "../infrastructure/crypto/github-app-webhook-verifier";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  beginVerifiedFencedWebhookDelivery,
  claimVerifiedFencedWebhookDelivery,
  claimVerifiedFencedWebhookDeliveryInTransaction,
  failWebhookFencedDelivery,
  reclaimWebhookFence,
  renewWebhookFence,
  runWebhookFencedDatabaseEffect,
} from "../infrastructure/prisma/webhook-effect-fence";

// Explicitly opt into a disposable Unix-socket database. This test never
// connects to an application's configured DATABASE_URL.
const test = webhookFencePostgres.enabled ? describe : describe.skip;

test("webhook database-effect fencing in isolated PostgreSQL", () => {
  const schema = `webhook_fence_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    options: `-c search_path=${schema}`,
  });
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const deliveryId = "synthetic-delivery";
  const realPrisma = new PrismaClient({
    adapter: new PrismaPg(pool, { schema }),
  });
  // This adapter exercises the implementation's SQL and transaction boundary
  // on real PostgreSQL. It is not a generated Prisma integration test.
  const prisma = {
    async $queryRaw(query: Prisma.Sql) {
      const result = await pool.query(query.text, query.values);
      return result.rows.map((row) => ({
        ...row,
        ...(row.generation === undefined
          ? {}
          : { generation: BigInt(row.generation) }),
      }));
    },
    async $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          async $queryRaw(query: Prisma.Sql) {
            return (await client.query(query.text, query.values)).rows;
          },
          async $executeRaw(query: Prisma.Sql) {
            return (await client.query(query.text, query.values)).rowCount;
          },
          gitHubWebhookDelivery: {
            async create({ data }: { data: { deliveryId: string } }) {
              return client.query(
                'INSERT INTO "GitHubWebhookDelivery" ("deliveryId") VALUES ($1)',
                [data.deliveryId],
              );
            },
          },
        } as unknown as Prisma.TransactionClient;
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  } as never;

  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      "CREATE TYPE \"WebhookDeliveryStatus\" AS ENUM ('received','processing','processed','failed')",
    );
    await pool.query(`CREATE TABLE "GitHubWebhookDelivery" (
      id TEXT PRIMARY KEY DEFAULT 'synthetic-' || md5(random()::text),
      "deliveryId" TEXT UNIQUE NOT NULL,
      "eventName" TEXT NOT NULL DEFAULT 'pull_request',
      action TEXT, "installationId" BIGINT, "payloadHash" TEXT, "normalizedEvent" JSONB,
      status "WebhookDeliveryStatus" NOT NULL DEFAULT 'processing',
      "errorSummary" TEXT, "processedAt" TIMESTAMP(3),
      "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const migration = await readFile(
      new URL(
        "../../../../platform/db/prisma/migrations/000165_webhook_effect_fence/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pool.query(migration);
    await pool.query('CREATE TABLE "effect" (generation bigint NOT NULL)');
    await pool.query(
      'CREATE TABLE "scope_authority" (version integer NOT NULL)',
    );
    await pool.query('INSERT INTO "scope_authority" VALUES (1)');
    await pool.query(
      'INSERT INTO "GitHubWebhookDelivery" ("deliveryId") VALUES ($1)',
      [deliveryId],
    );
    await pool.query(
      'INSERT INTO "GitHubWebhookFence" ("deliveryId","ownerHash","appIdentityHash","generation","leaseUntil") VALUES ($1,$2,$3,1,clock_timestamp()+interval \'1 minute\')',
      [deliveryId, a, "d".repeat(64)],
    );
  });
  afterAll(async () => {
    await realPrisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  function verifiedEvent(
    id: string,
    appId = "123",
    body = '{"action":"opened"}',
  ) {
    const secret = "synthetic-secret";
    const rawPayload = Buffer.from(body);
    const context = createGitHubAppWebhookVerifier({
      appId,
      apiBaseUrl: "https://api.github.com",
      webhookSecret: secret,
    })({
      rawPayload,
      signatureHeader: `sha256=${createHmac("sha256", secret).update(rawPayload).digest("hex")}`,
    })!;
    return {
      context,
      delivery: {
        deliveryId: id,
        eventName: "pull_request",
        action: "opened",
        installationId: "123",
        payloadHash: context.payloadHash,
      },
    };
  }

  async function seedFutureFencedReceipt(
    event: ReturnType<typeof verifiedEvent>,
    repositoryId: string | null = null,
  ) {
    const claim = {
      deliveryId: event.delivery.deliveryId,
      ownerHash: a,
      appIdentityHash: event.context.appIdentityHash,
      generation: 1n,
    };
    // Model a receipt retained from before a database clock rollback. Insert
    // its identity before the fence, without altering the host clock or trigger.
    await realPrisma.$transaction(async (tx) => {
      await acquireCurrentScopeGuards(tx, [
        { scope: "global", mode: "exclusive" },
      ]);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "GitHubWebhookDelivery"
          ("deliveryId", "eventName", action, "installationId", "payloadHash", "normalizedEvent", "receivedAt")
        VALUES (${claim.deliveryId}, ${event.delivery.eventName}, ${event.delivery.action},
          ${BigInt(event.delivery.installationId)}, ${event.context.payloadHash},
          ${repositoryId === null ? null : JSON.stringify({ repositoryId })}::jsonb,
          (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 hour')
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "GitHubWebhookFence"
          ("deliveryId", "ownerHash", "appIdentityHash", generation, "leaseUntil", "signatureHash")
        VALUES (${claim.deliveryId}, ${a}, ${claim.appIdentityHash}, 1,
          clock_timestamp() + interval '1 minute', ${event.context.signatureHash})
      `);
    });
    expect(
      await failWebhookFencedDelivery(realPrisma, claim, "synthetic_failure"),
    ).toBe(true);
    return claim;
  }

  it("recovers the exact failed generation and protects its terminal receipt from legacy writers", async () => {
    const { context, delivery } = verifiedEvent("claim-failure-recovery");
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await expect(
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_delivery_unconfirmed");
    await expect(
      runWebhookFencedDatabaseEffect(realPrisma, first.claim, async (tx) => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO "effect" VALUES (91)`);
        throw new Error("synthetic_rollback");
      }),
    ).rejects.toThrow("synthetic_rollback");
    expect(
      await failWebhookFencedDelivery(
        realPrisma,
        first.claim,
        "synthetic_rollback",
      ),
    ).toBe(true);
    const second = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      b,
      10000,
    );
    if (second.kind !== "claimed") throw new Error("claim_required");
    expect(second.claim.generation).toBe(2n);
    expect(
      await failWebhookFencedDelivery(realPrisma, first.claim, "stale failure"),
    ).toBe(false);
    await runWebhookFencedDatabaseEffect(
      realPrisma,
      second.claim,
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO "effect" VALUES (92)`);
        await tx.gitHubWebhookDelivery.update({
          where: { deliveryId: delivery.deliveryId },
          data: { status: "processed" },
        });
      },
      "processed",
    );
    expect(
      await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        "c".repeat(64),
        10000,
      ),
    ).toEqual({ kind: "processed" });
    const legacy = new PrismaWebhookDeliveryRepository(realPrisma);
    await expect(
      legacy.markFailed({
        deliveryId: delivery.deliveryId,
        errorSummary: "late legacy failure",
      }),
    ).rejects.toThrow();
    await expect(legacy.markProcessed(delivery.deliveryId)).rejects.toThrow();
    await expect(
      realPrisma.gitHubWebhookDelivery.delete({
        where: { deliveryId: delivery.deliveryId },
      }),
    ).rejects.toThrow();
    expect(
      await failWebhookFencedDelivery(realPrisma, second.claim, "late failure"),
    ).toBe(false);
    expect(
      (
        await pool.query(
          'SELECT generation FROM "effect" WHERE generation IN (91,92) ORDER BY generation',
        )
      ).rows.map((row) => row.generation),
    ).toEqual(["92"]);
  });

  it("compares App, raw body and event identity after a successful delivery", async () => {
    const { context, delivery } = verifiedEvent("exact-terminal-identity");
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await runWebhookFencedDatabaseEffect(
      realPrisma,
      first.claim,
      async (tx) => {
        await tx.gitHubWebhookDelivery.update({
          where: { deliveryId: delivery.deliveryId },
          data: { status: "processed" },
        });
      },
      "processed",
    );
    for (const changes of [
      { eventName: "repository" },
      { action: "closed" },
      { installationId: "456" },
    ]) {
      await expect(
        claimVerifiedFencedWebhookDelivery(
          realPrisma,
          context,
          { ...delivery, ...changes },
          b,
          10000,
        ),
      ).rejects.toThrow("webhook_fence_identity_mismatch");
    }
    for (const alternative of [
      verifiedEvent(delivery.deliveryId, "456"),
      verifiedEvent(delivery.deliveryId, "123", '{"action":"changed"}'),
    ]) {
      await expect(
        claimVerifiedFencedWebhookDelivery(
          realPrisma,
          alternative.context,
          alternative.delivery,
          b,
          10000,
        ),
      ).rejects.toThrow("webhook_fence_identity_mismatch");
    }
  });

  it.each(["processing", "failed"] as const)(
    "never takes over a legacy %s row",
    async (status) => {
      const { context, delivery } = verifiedEvent(`legacy-${status}`);
      await realPrisma.gitHubWebhookDelivery.create({
        data: { ...delivery, installationId: 123n, status },
      });
      await expect(
        claimVerifiedFencedWebhookDelivery(
          realPrisma,
          context,
          delivery,
          a,
          10000,
        ),
      ).rejects.toThrow("webhook_fence_legacy_delivery");
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM "GitHubWebhookFence" WHERE "deliveryId"=$1',
            [delivery.deliveryId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );

  it("lets exactly one authenticated duplicate recover an expired owner", async () => {
    const { context, delivery } = verifiedEvent("authenticated-takeover");
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    const results = await Promise.allSettled([
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        10000,
      ),
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        "c".repeat(64),
        10000,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await failWebhookFencedDelivery(realPrisma, first.claim, "stale failure"),
    ).toBe(false);
    await expect(
      runWebhookFencedDatabaseEffect(realPrisma, first.claim, async () => {
        throw new Error("must_not_run");
      }),
    ).rejects.toThrow("webhook_fence_stale");
  });

  it.each(["installation", "installation_repositories"] as const)(
    "does not replay %s over a same-time receipt for the installation",
    async (eventName) => {
      const { context, delivery: original } = verifiedEvent(
        `superseded-${eventName}`,
      );
      const delivery = {
        ...original,
        eventName,
        action: eventName === "installation" ? "created" : "added",
        installationId: eventName === "installation" ? "90101" : "90102",
      };
      const first = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        a,
        10000,
      );
      if (first.kind !== "claimed") throw new Error("claim_required");
      await failWebhookFencedDelivery(
        realPrisma,
        first.claim,
        "synthetic_failure",
      );
      // A legacy receipt has unknown App identity. Equal timestamps must also
      // fail closed; receipt precision must not permit the older activation.
      await pool.query(
        'INSERT INTO "GitHubWebhookDelivery" ("deliveryId","eventName","action","installationId","receivedAt") SELECT $1, \'installation\', \'deleted\', "installationId", "receivedAt" FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$2',
        [`newer-${eventName}`, delivery.deliveryId],
      );
      await expect(
        claimVerifiedFencedWebhookDelivery(
          realPrisma,
          context,
          delivery,
          b,
          10000,
        ),
      ).rejects.toThrow("webhook_fence_reconciliation_required");
      const current = await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId: delivery.deliveryId },
      });
      expect(current.generation).toBe(1n);
      expect(current.ownerHash).toBe(a);
      expect(
        (
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: delivery.deliveryId },
          })
        ).status,
      ).toBe("failed");
    },
  );

  it.each([
    ["installation", "suspend", "90501"],
    ["installation_repositories", "removed", "90502"],
    ["repository", "deleted", "90503"],
  ] as const)(
    "orders new %s admission after a retry that has passed its replay check",
    async (eventName, action, installationId) => {
      const { context, delivery: original } = verifiedEvent(
        `admission-wait-${eventName}`,
        "123",
        JSON.stringify({ action }),
      );
      const delivery = {
        ...original,
        eventName,
        action,
        installationId,
        ...(eventName === "repository"
          ? { normalizedEvent: { repositoryId: "80503" } }
          : {}),
      };
      const first = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        a,
        30000,
      );
      if (first.kind !== "claimed") throw new Error("claim_required");
      expect(
        await failWebhookFencedDelivery(
          realPrisma,
          first.claim,
          "synthetic_failure",
        ),
      ).toBe(true);
      const retry = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        30000,
      );
      if (retry.kind !== "claimed") throw new Error("claim_required");
      expect(retry.claim.generation).toBe(2n);
      let entered!: (backendPid: number) => void;
      let release!: () => void;
      const ready = new Promise<number>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const terminal = runWebhookFencedDatabaseEffect(
        realPrisma,
        retry.claim,
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>(
            Prisma.sql`SELECT pg_backend_pid() AS pid`,
          );
          if (!rows[0]) throw new Error("effect_backend_missing");
          // The replay check has passed and the scope stays held through COMMIT.
          entered(rows[0].pid);
          await held;
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "effect" (generation) VALUES (${BigInt(installationId)})`,
          );
          await tx.gitHubWebhookDelivery.update({
            where: { deliveryId: delivery.deliveryId },
            data: { status: "processed" },
          });
        },
        "processed",
        (tx) =>
          acquireCurrentScopeGuards(tx, [
            { scope: "global", mode: "exclusive" },
          ]),
      ).then(
        () => null,
        (error: unknown) => error,
      );
      const newer = { ...delivery, deliveryId: `newer-${delivery.deliveryId}` };
      let admission: Promise<unknown> = Promise.resolve();
      try {
        const ownerPid = await Promise.race([
          ready,
          terminal.then((error) => {
            throw error ?? new Error("effect_barrier_not_reached");
          }),
        ]);
        admission = claimVerifiedFencedWebhookDelivery(
          realPrisma,
          context,
          newer,
          a,
          30000,
        ).catch((error: unknown) => error);
        let blocked = false;
        for (let attempt = 0; attempt < 80 && !blocked; attempt++) {
          const result = await pool.query<{ blocked: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND $1 = ANY(pg_blocking_pids(pid))) AS blocked",
            [ownerPid],
          );
          blocked = result.rows[0]?.blocked === true;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        expect(
          await realPrisma.gitHubWebhookDelivery.findUnique({
            where: { deliveryId: newer.deliveryId },
          }),
        ).toBeNull();
        release();
        expect(await terminal).toBeNull();
        expect(await admission).toMatchObject({
          kind: "claimed",
          claim: { deliveryId: newer.deliveryId, generation: 1n },
        });
        expect(
          (
            await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
              where: { deliveryId: delivery.deliveryId },
            })
          ).status,
        ).toBe("processed");
        expect(
          (
            await pool.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM "effect" WHERE generation = $1',
              [installationId],
            )
          ).rows[0]?.n,
        ).toBe(1);
      } finally {
        release();
        await terminal;
        await admission;
      }
    },
  );

  it.each([
    ["installation", "suspend", "90601"],
    ["installation_repositories", "removed", "90602"],
    ["repository", "deleted", "90603"],
  ] as const)(
    "rejects a %s retry effect after a newer authenticated receipt committed",
    async (eventName, action, installationId) => {
      const { context, delivery: original } = verifiedEvent(
        `admission-before-retry-${eventName}`,
        "123",
        JSON.stringify({ action }),
      );
      const delivery = {
        ...original,
        eventName,
        action,
        installationId,
        ...(eventName === "repository"
          ? { normalizedEvent: { repositoryId: "80603" } }
          : {}),
      };
      const first = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        a,
        30000,
      );
      if (first.kind !== "claimed") throw new Error("claim_required");
      await failWebhookFencedDelivery(
        realPrisma,
        first.claim,
        "synthetic_failure",
      );
      const retry = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        30000,
      );
      if (retry.kind !== "claimed") throw new Error("claim_required");
      const newer = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        { ...delivery, deliveryId: `newer-${delivery.deliveryId}` },
        a,
        30000,
      );
      expect(newer.kind).toBe("claimed");
      let effectRan = false;
      await expect(
        runWebhookFencedDatabaseEffect(
          realPrisma,
          retry.claim,
          async () => {
            effectRan = true;
          },
          "processing",
          (tx) =>
            acquireCurrentScopeGuards(tx, [
              { scope: "global", mode: "exclusive" },
            ]),
        ),
      ).rejects.toThrow("webhook_fence_reconciliation_required");
      expect(effectRan).toBe(false);
      expect(
        (
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: delivery.deliveryId },
          })
        ).status,
      ).toBe("processing");
      expect(
        (
          await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
            where: { deliveryId: delivery.deliveryId },
          })
        ).generation,
      ).toBe(2n);
    },
  );

  it.each([
    ["installation", "suspend", "unsuspend", "90701"],
    ["installation_repositories", "removed", "added", "90702"],
    ["repository", "deleted", "renamed", "90703"],
  ] as const)(
    "orders %s receipts by guarded admission when transaction start order is reversed",
    async (eventName, earlierAction, laterAction, installationId) => {
      const earlierEvent = verifiedEvent(
        `receipt-order-earlier-${eventName}`,
        "123",
        JSON.stringify({ action: earlierAction }),
      );
      const laterEvent = verifiedEvent(
        `receipt-order-later-${eventName}`,
        "123",
        JSON.stringify({ action: laterAction }),
      );
      const scope = {
        eventName,
        installationId,
        ...(eventName === "repository"
          ? { normalizedEvent: { repositoryId: "80703" } }
          : {}),
      };
      const earlierDelivery = {
        ...earlierEvent.delivery,
        ...scope,
        action: earlierAction,
      };
      const laterDelivery = {
        ...laterEvent.delivery,
        ...scope,
        action: laterAction,
      };
      let entered!: (startedMs: bigint) => void;
      let release!: () => void;
      const ready = new Promise<bigint>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = realPrisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ startedMs: bigint }>>(
            Prisma.sql`SELECT floor(extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS "startedMs" FROM pg_sleep(0.005)`,
          );
          if (!rows[0]) throw new Error("transaction_start_missing");
          // This pause precedes admission; the later-started transaction can
          // acquire the actual scope lock and commit its receipt first.
          entered(rows[0].startedMs);
          await held;
          return claimVerifiedFencedWebhookDeliveryInTransaction(
            tx,
            laterEvent.context,
            laterDelivery,
            a,
            30000,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      const delayedOutcome = delayed.then(
        () => null,
        (error: unknown) => error,
      );
      try {
        const olderStartedMs = await Promise.race([
          ready,
          delayedOutcome.then((error) => {
            throw error ?? new Error("transaction_barrier_not_reached");
          }),
        ]);
        const earlier = await realPrisma.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<Array<{ startedMs: bigint }>>(
              Prisma.sql`SELECT floor(extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS "startedMs"`,
            );
            if (!rows[0]) throw new Error("transaction_start_missing");
            const result =
              await claimVerifiedFencedWebhookDeliveryInTransaction(
                tx,
                earlierEvent.context,
                earlierDelivery,
                a,
                30000,
              );
            return { startedMs: rows[0].startedMs, result };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        expect(earlier.startedMs).toBeGreaterThan(olderStartedMs);
        if (earlier.result.kind !== "claimed")
          throw new Error("claim_required");
        expect(
          await failWebhookFencedDelivery(
            realPrisma,
            earlier.result.claim,
            "synthetic_failure",
          ),
        ).toBe(true);
        const originalReceipt =
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: earlierDelivery.deliveryId },
          });
        release();
        const later = await delayed;
        if (later.kind !== "claimed") throw new Error("claim_required");
        const order = await pool.query<{ ordered: boolean }>(
          'SELECT later."receivedAt" >= earlier."receivedAt" AS ordered FROM "GitHubWebhookDelivery" later CROSS JOIN "GitHubWebhookDelivery" earlier WHERE later."deliveryId"=$1 AND earlier."deliveryId"=$2',
          [laterDelivery.deliveryId, earlierDelivery.deliveryId],
        );
        expect(order.rows[0]?.ordered).toBe(true);
        await runWebhookFencedDatabaseEffect(
          realPrisma,
          later.claim,
          async (tx) => {
            await tx.$executeRaw(
              Prisma.sql`INSERT INTO "effect" (generation) VALUES (${BigInt(installationId)})`,
            );
            await tx.gitHubWebhookDelivery.update({
              where: { deliveryId: laterDelivery.deliveryId },
              data: { status: "processed" },
            });
          },
          "processed",
          (tx) =>
            acquireCurrentScopeGuards(tx, [
              { scope: "global", mode: "exclusive" },
            ]),
        );
        await expect(
          claimVerifiedFencedWebhookDelivery(
            realPrisma,
            earlierEvent.context,
            earlierDelivery,
            b,
            30000,
          ),
        ).rejects.toThrow("webhook_fence_reconciliation_required");
        const retained =
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: earlierDelivery.deliveryId },
          });
        expect(retained.receivedAt).toEqual(originalReceipt.receivedAt);
        expect(retained.status).toBe("failed");
        expect(
          await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
            where: { deliveryId: earlierDelivery.deliveryId },
          }),
        ).toMatchObject({ ownerHash: a, generation: 1n });
        expect(
          (
            await pool.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM "effect" WHERE generation=$1',
              [installationId],
            )
          ).rows[0]?.n,
        ).toBe(1);
      } finally {
        release();
        await delayedOutcome;
      }
    },
  );

  it.each([
    {
      name: "installation",
      priorEvent: "installation",
      priorAction: "suspend",
      priorInstallation: "90801",
      nextEvent: "installation",
      nextAction: "unsuspend",
      nextInstallation: "90801",
      repositoryId: null,
    },
    {
      name: "repository-lifecycle",
      priorEvent: "repository",
      priorAction: "deleted",
      priorInstallation: "90802",
      nextEvent: "installation_repositories",
      nextAction: "added",
      nextInstallation: "90802",
      repositoryId: "80802",
    },
    {
      name: "repository-transfer",
      priorEvent: "repository",
      priorAction: "deleted",
      priorInstallation: "90803",
      nextEvent: "repository",
      nextAction: "renamed",
      nextInstallation: "90804",
      repositoryId: "80803",
    },
  ] as const)(
    "keeps $name admission ordered after a database clock rollback",
    async (scenario) => {
      const original = verifiedEvent(
        `clock-prior-${scenario.name}`,
        "123",
        JSON.stringify({ action: scenario.priorAction }),
      );
      const prior = {
        ...original,
        delivery: {
          ...original.delivery,
          eventName: scenario.priorEvent,
          action: scenario.priorAction,
          installationId: scenario.priorInstallation,
          ...(scenario.repositoryId === null
            ? {}
            : { normalizedEvent: { repositoryId: scenario.repositoryId } }),
        },
      };
      await seedFutureFencedReceipt(prior, scenario.repositoryId);
      const next = verifiedEvent(
        `clock-next-${scenario.name}`,
        "123",
        JSON.stringify({ action: scenario.nextAction }),
      );
      const delivery = {
        ...next.delivery,
        eventName: scenario.nextEvent,
        action: scenario.nextAction,
        installationId: scenario.nextInstallation,
        ...(scenario.nextEvent === "repository"
          ? { normalizedEvent: { repositoryId: scenario.repositoryId } }
          : {}),
      };
      const acquired = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        next.context,
        delivery,
        a,
        30000,
      );
      if (acquired.kind !== "claimed") throw new Error("claim_required");
      const order = await pool.query<{
        ordered: boolean;
        leaseUsesWallClock: boolean;
      }>(
        `SELECT next."receivedAt" > prior."receivedAt" AS ordered,
          f."leaseUntil" < (next."receivedAt" AT TIME ZONE 'UTC') AS "leaseUsesWallClock"
          FROM "GitHubWebhookDelivery" next
          JOIN "GitHubWebhookFence" f ON f."deliveryId"=next."deliveryId"
          CROSS JOIN "GitHubWebhookDelivery" prior
          WHERE next."deliveryId"=$1 AND prior."deliveryId"=$2`,
        [delivery.deliveryId, prior.delivery.deliveryId],
      );
      expect(order.rows[0]).toEqual({
        ordered: true,
        leaseUsesWallClock: true,
      });
      await runWebhookFencedDatabaseEffect(
        realPrisma,
        acquired.claim,
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "effect" VALUES (${BigInt(scenario.nextInstallation)})`,
          );
          await tx.gitHubWebhookDelivery.update({
            where: { deliveryId: delivery.deliveryId },
            data: { status: "processed" },
          });
        },
        "processed",
        (tx) =>
          acquireCurrentScopeGuards(tx, [
            { scope: "global", mode: "exclusive" },
          ]),
      );
      await expect(
        claimVerifiedFencedWebhookDelivery(
          realPrisma,
          prior.context,
          prior.delivery,
          b,
          30000,
        ),
      ).rejects.toThrow("webhook_fence_reconciliation_required");
      expect(
        await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
          where: { deliveryId: prior.delivery.deliveryId },
        }),
      ).toMatchObject({ generation: 1n, ownerHash: a });
      expect(
        (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM "effect" WHERE generation=$1',
            [scenario.nextInstallation],
          )
        ).rows[0]?.n,
      ).toBe(1);
    },
  );

  it.each([
    ["Asia/Tokyo", "91001", true],
    ["Pacific/Honolulu", "91002", false],
  ] as const)(
    "orders fenced admission after an existing legacy default in %s without rewriting it",
    async (timezone, installationId, legacyAhead) => {
      const legacyId = `legacy-clock-${installationId}`;
      const legacy = await realPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
        // Exercise PostgreSQL's actual default in this session. The absent
        // canonical repository identity must still contribute a floor.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "GitHubWebhookDelivery"
            ("deliveryId", "eventName", action, "installationId", status)
          VALUES (${legacyId}, 'repository', 'deleted', ${BigInt(installationId)}, 'processing')
        `);
        return tx.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: legacyId },
        });
      });
      const event = verifiedEvent(
        `fenced-clock-${installationId}`,
        "123",
        '{"action":"renamed"}',
      );
      const delivery = {
        ...event.delivery,
        eventName: "repository",
        action: "renamed",
        installationId,
        normalizedEvent: { repositoryId: `8${installationId}` },
      };
      const first = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        event.context,
        delivery,
        a,
        30000,
      );
      if (first.kind !== "claimed") throw new Error("claim_required");
      const order = await pool.query<{
        ordered: boolean;
        legacyAhead: boolean;
      }>(
        `SELECT next."receivedAt" > prior."receivedAt" AS ordered,
          prior."receivedAt" > (clock_timestamp() AT TIME ZONE 'UTC') AS "legacyAhead"
          FROM "GitHubWebhookDelivery" next CROSS JOIN "GitHubWebhookDelivery" prior
          WHERE next."deliveryId"=$1 AND prior."deliveryId"=$2`,
        [delivery.deliveryId, legacyId],
      );
      expect(order.rows[0]).toEqual({ ordered: true, legacyAhead });
      const received = await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow(
        {
          where: { deliveryId: delivery.deliveryId },
        },
      );
      expect(
        await failWebhookFencedDelivery(
          realPrisma,
          first.claim,
          "synthetic_failure",
        ),
      ).toBe(true);
      const retry = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        event.context,
        delivery,
        b,
        30000,
      );
      if (retry.kind !== "claimed") throw new Error("claim_required");
      expect(retry.claim.generation).toBe(2n);
      await runWebhookFencedDatabaseEffect(
        realPrisma,
        retry.claim,
        async (tx) => {
          await tx.gitHubWebhookDelivery.update({
            where: { deliveryId: delivery.deliveryId },
            data: { status: "processed" },
          });
        },
        "processed",
        (tx) =>
          acquireCurrentScopeGuards(tx, [
            { scope: "global", mode: "exclusive" },
          ]),
      );
      expect(
        (
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: delivery.deliveryId },
          })
        ).receivedAt,
      ).toEqual(received.receivedAt);
      expect(
        await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: legacyId },
        }),
      ).toEqual(legacy);
      expect(
        await realPrisma.gitHubWebhookFence.findUnique({
          where: { deliveryId: legacyId },
        }),
      ).toBeNull();
    },
  );

  it.each([
    ["different-app", "456", "90901", "90901"],
    ["different-installation", "123", "90902", "90903"],
  ] as const)(
    "excludes a proven %s receipt from the admission floor",
    async (name, priorApp, priorInstallation, nextInstallation) => {
      const priorEvent = verifiedEvent(
        `clock-isolation-prior-${name}`,
        priorApp,
        '{"action":"removed"}',
      );
      const prior = {
        ...priorEvent,
        delivery: {
          ...priorEvent.delivery,
          eventName: "installation_repositories",
          action: "removed",
          installationId: priorInstallation,
        },
      };
      await seedFutureFencedReceipt(prior);
      const next = verifiedEvent(
        `clock-isolation-next-${name}`,
        "123",
        '{"action":"unsuspend"}',
      );
      const delivery = {
        ...next.delivery,
        eventName: "installation",
        action: "unsuspend",
        installationId: nextInstallation,
      };
      const first = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        next.context,
        delivery,
        a,
        30000,
      );
      if (first.kind !== "claimed") throw new Error("claim_required");
      const rows = await pool.query<{ isolated: boolean }>(
        `SELECT next."receivedAt" < prior."receivedAt" AS isolated
          FROM "GitHubWebhookDelivery" next CROSS JOIN "GitHubWebhookDelivery" prior
          WHERE next."deliveryId"=$1 AND prior."deliveryId"=$2`,
        [delivery.deliveryId, prior.delivery.deliveryId],
      );
      expect(rows.rows[0]?.isolated).toBe(true);
      expect(
        await failWebhookFencedDelivery(
          realPrisma,
          first.claim,
          "synthetic_failure",
        ),
      ).toBe(true);
      const retry = await claimVerifiedFencedWebhookDelivery(
        realPrisma,
        next.context,
        delivery,
        b,
        30000,
      );
      expect(retry).toMatchObject({
        kind: "claimed",
        claim: { generation: 2n },
      });
    },
  );

  it("does not confuse another installation or a proven different App with supersession", async () => {
    const { context, delivery: original } = verifiedEvent("unrelated-receipts");
    const delivery = {
      ...original,
      eventName: "installation",
      action: "created",
      installationId: "90103",
    };
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await failWebhookFencedDelivery(
      realPrisma,
      first.claim,
      "synthetic_failure",
    );
    await beginFencedWebhookDelivery(
      realPrisma,
      { ...delivery, deliveryId: "different-app-receipt" },
      a,
      10000,
      "f".repeat(64),
    );
    await pool.query(
      'INSERT INTO "GitHubWebhookDelivery" ("deliveryId","eventName","action","installationId","receivedAt") SELECT \'different-installation-receipt\', \'installation\', \'deleted\', 90104, "receivedAt" FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    const second = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      b,
      10000,
    );
    if (second.kind !== "claimed") throw new Error("claim_required");
    expect(second.claim.generation).toBe(2n);
    await runWebhookFencedDatabaseEffect(
      realPrisma,
      second.claim,
      async (tx) => {
        await tx.gitHubWebhookDelivery.update({
          where: { deliveryId: delivery.deliveryId },
          data: { status: "processed" },
        });
      },
      "processed",
    );
  });

  it("rechecks repository supersession after the authority lock wait and before any effect", async () => {
    const { context, delivery: original } = verifiedEvent(
      "repository-replay-wait",
    );
    const delivery = {
      ...original,
      eventName: "repository",
      action: "deleted",
      installationId: "90201",
      normalizedEvent: { repositoryId: "80201" },
    };
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await failWebhookFencedDelivery(
      realPrisma,
      first.claim,
      "synthetic_failure",
    );
    const second = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      b,
      10000,
    );
    if (second.kind !== "claimed") throw new Error("claim_required");
    const holder = await pool.connect();
    let effectRan = false;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(239893)");
      const attempt = runWebhookFencedDatabaseEffect(
        realPrisma,
        second.claim,
        async () => {
          effectRan = true;
        },
        "processing",
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(239893)`,
          );
        },
      ).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForAdvisoryWait(pool, 239893);
      // The repository transferred to another installation after acquisition.
      // The current effect must see this commit after its scope lock is granted.
      await holder.query(
        'INSERT INTO "GitHubWebhookDelivery" ("deliveryId","eventName","action","installationId","normalizedEvent","receivedAt") SELECT \'repository-new-owner\', \'repository\', \'transferred\', 90202, "normalizedEvent", "receivedAt" FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
        [delivery.deliveryId],
      );
      await holder.query("COMMIT");
      expect(await attempt).toMatchObject({
        message: "webhook_fence_reconciliation_required",
      });
      expect(effectRan).toBe(false);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("requires a canonical repository identity before replaying repository effects", async () => {
    const { context, delivery: original } = verifiedEvent(
      "repository-missing-replay-identity",
    );
    const delivery = {
      ...original,
      eventName: "repository",
      action: "deleted",
      installationId: "90301",
    };
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await failWebhookFencedDelivery(
      realPrisma,
      first.claim,
      "synthetic_failure",
    );
    await expect(
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_reconciliation_required");
  });

  it("fails closed when a newer repository receipt cannot prove a different repository", async () => {
    const { context, delivery: original } = verifiedEvent(
      "repository-unknown-newer",
    );
    const delivery = {
      ...original,
      eventName: "repository",
      action: "deleted",
      installationId: "90302",
      normalizedEvent: { repositoryId: "80302" },
    };
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await failWebhookFencedDelivery(
      realPrisma,
      first.claim,
      "synthetic_failure",
    );
    await pool.query(
      'INSERT INTO "GitHubWebhookDelivery" ("deliveryId","eventName","action","installationId","receivedAt") SELECT \'repository-unknown-newer-legacy\', \'repository\', \'transferred\', "installationId", "receivedAt" FROM "GitHubWebhookDelivery" WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    await expect(
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_reconciliation_required");
  });

  it("preserves receipt order even inside an otherwise authorized effect transaction", async () => {
    const { context, delivery } = verifiedEvent("receipt-order-immutable");
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    const before = await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: { deliveryId: delivery.deliveryId },
    });
    await expect(
      runWebhookFencedDatabaseEffect(realPrisma, first.claim, async (tx) => {
        await tx.gitHubWebhookDelivery.update({
          where: { deliveryId: delivery.deliveryId },
          data: { receivedAt: new Date(before.receivedAt.getTime() + 1000) },
        });
      }),
    ).rejects.toThrow("webhook_fence_identity_immutable");
    const after = await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: { deliveryId: delivery.deliveryId },
    });
    expect(after.receivedAt).toEqual(before.receivedAt);
  });

  it("requires reconciliation for authorization revocation with no original grant revision", async () => {
    const { context, delivery: original } = verifiedEvent(
      "authorization-reconnect",
    );
    const delivery = {
      ...original,
      eventName: "github_app_authorization",
      action: "revoked",
      installationId: null,
      normalizedEvent: { senderId: "90401" },
    };
    const first = await claimVerifiedFencedWebhookDelivery(
      realPrisma,
      context,
      delivery,
      a,
      10000,
    );
    if (first.kind !== "claimed") throw new Error("claim_required");
    await failWebhookFencedDelivery(
      realPrisma,
      first.claim,
      "synthetic_failure",
    );
    await expect(
      claimVerifiedFencedWebhookDelivery(
        realPrisma,
        context,
        delivery,
        b,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_reconciliation_required");
  });

  it("binds creation to the verified body and trusted App configuration", async () => {
    const body = Buffer.from('{"action":"opened"}');
    const secret = "synthetic-secret";
    const verify = createGitHubAppWebhookVerifier({
      appId: "123",
      apiBaseUrl: "https://api.github.com",
      webhookSecret: secret,
    });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const verified = verify({ rawPayload: body, signatureHeader: signature });
    expect(verified).not.toBeNull();
    const delivery = {
      deliveryId: "verified-app",
      eventName: "pull_request",
      payloadHash: verified!.payloadHash,
    };
    await expect(
      beginVerifiedFencedWebhookDelivery(
        realPrisma,
        { ...verified },
        delivery,
        a,
        10000,
      ),
    ).rejects.toThrow("github_app_webhook_unverified");
    await expect(
      beginVerifiedFencedWebhookDelivery(
        realPrisma,
        verified,
        { ...delivery, payloadHash: "e".repeat(64) },
        a,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_payload_mismatch");
    const claim = await beginVerifiedFencedWebhookDelivery(
      realPrisma,
      verified,
      delivery,
      a,
      10000,
    );
    expect(claim.appIdentityHash).toBe(verified!.appIdentityHash);
    expect(await renewWebhookFence(realPrisma, claim, 10000)).toBe(true);
  });

  it("rejects a different authenticated app identity for the same delivery", async () => {
    const delivery = { deliveryId: "app-bound", eventName: "push" };
    const claim = await beginFencedWebhookDelivery(
      realPrisma,
      delivery,
      a,
      10000,
      "d".repeat(64),
    );
    const otherApp = { ...claim, appIdentityHash: "e".repeat(64) };
    expect(await renewWebhookFence(realPrisma, otherApp, 10000)).toBe(false);
    await expect(
      runWebhookFencedDatabaseEffect(realPrisma, otherApp, async () => {
        throw new Error("must_not_run");
      }),
    ).rejects.toThrow("webhook_fence_stale");
    await expect(
      beginFencedWebhookDelivery(
        realPrisma,
        delivery,
        b,
        10000,
        otherApp.appIdentityHash,
      ),
    ).rejects.toMatchObject({ code: "P2002" });
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    expect(
      await reclaimWebhookFence(realPrisma, otherApp, b, 10000),
    ).toBeNull();
    const reclaimed = await reclaimWebhookFence(realPrisma, claim, b, 10000);
    expect(reclaimed?.appIdentityHash).toBe(claim.appIdentityHash);
  });

  it("creates and guards a delivery using the generated Prisma client", async () => {
    const identity = {
      deliveryId: "real-prisma-delivery",
      eventName: "pull_request",
    };
    const claim = await beginFencedWebhookDelivery(
      realPrisma,
      identity,
      a,
      10000,
      "d".repeat(64),
    );
    expect(await renewWebhookFence(realPrisma, claim, 10000)).toBe(true);
    await runWebhookFencedDatabaseEffect(realPrisma, claim, async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`INSERT INTO "effect" VALUES (5) RETURNING generation`,
      );
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "effect" WHERE generation=5',
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("does not renew a delivery that became terminal while renewal waited", async () => {
    const identity = {
      deliveryId: "renew-after-terminal-wait",
      eventName: "push",
    };
    const claim = await beginFencedWebhookDelivery(
      realPrisma,
      identity,
      a,
      30000,
      "d".repeat(64),
    );
    const initial = await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
      where: { deliveryId: identity.deliveryId },
    });
    let entered!: (backendPid: number) => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const terminal = runWebhookFencedDatabaseEffect(
      realPrisma,
      claim,
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        if (!rows[0]) throw new Error("terminal_backend_missing");
        await tx.gitHubWebhookDelivery.update({
          where: { deliveryId: identity.deliveryId },
          data: { status: "processed" },
        });
        entered(rows[0].pid);
        await held;
      },
      "processed",
    ).then(
      () => null,
      (error: unknown) => error,
    );
    let renewal: Promise<unknown> = Promise.resolve();
    try {
      const ownerPid = await Promise.race([
        ready,
        terminal.then((error) => {
          throw error ?? new Error("terminal_barrier_not_reached");
        }),
      ]);
      renewal = renewWebhookFence(realPrisma, claim, 60000).catch(
        (error: unknown) => error,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 80 && !blocked; attempt++) {
        const result = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
          [ownerPid],
        );
        blocked = result.rows[0]?.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      release();
      expect(await terminal).toBeNull();
      expect(await renewal).toBe(false);
      expect(
        (
          await realPrisma.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: identity.deliveryId },
          })
        ).status,
      ).toBe("processed");
      expect(
        (
          await realPrisma.gitHubWebhookFence.findUniqueOrThrow({
            where: { deliveryId: identity.deliveryId },
          })
        ).leaseUntil,
      ).toEqual(initial.leaseUntil);
    } finally {
      release();
      await terminal;
      await renewal;
    }
  });

  it("uses real Prisma to fence a stale owner after concurrent takeover", async () => {
    const identity = {
      deliveryId: "real-prisma-race",
      eventName: "pull_request",
    };
    const previous = await beginFencedWebhookDelivery(
      realPrisma,
      identity,
      a,
      10000,
      "d".repeat(64),
    );
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [identity.deliveryId],
    );
    const candidates = await Promise.all([
      reclaimWebhookFence(realPrisma, previous, "e".repeat(64), 10000),
      reclaimWebhookFence(realPrisma, previous, "f".repeat(64), 10000),
    ]);
    expect(candidates.filter(Boolean)).toHaveLength(1);
    const winner = candidates.find((candidate) => candidate !== null)!;
    await expect(
      runWebhookFencedDatabaseEffect(realPrisma, previous, async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`INSERT INTO "effect" VALUES (6) RETURNING generation`,
        );
      }),
    ).rejects.toThrow("webhook_fence_stale");
    await runWebhookFencedDatabaseEffect(realPrisma, winner, async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`INSERT INTO "effect" VALUES (7) RETURNING generation`,
      );
    });
    const { rows } = await pool.query(
      'SELECT generation FROM "effect" WHERE generation IN (6,7)',
    );
    expect(rows.map((row) => row.generation)).toEqual(["7"]);
  });

  it("acquires the existing authority lock before the delivery fence", async () => {
    const identity = {
      deliveryId: "scope-lock-race",
      eventName: "pull_request",
    };
    const previous = await beginFencedWebhookDelivery(
      realPrisma,
      identity,
      a,
      10000,
      "d".repeat(64),
    );
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(129981)");
      const attempt = runWebhookFencedDatabaseEffect(
        realPrisma,
        previous,
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`INSERT INTO "effect" VALUES (8) RETURNING generation`,
          );
        },
        "processing",
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(129981)`,
          );
        },
      ).then(
        () => null,
        (error: unknown) => error,
      );
      let waiting = false;
      for (let i = 0; i < 80 && !waiting; i++) {
        const result = await pool.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        waiting = result.rows[0].n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      // If the delivery fence were acquired first this update would block.
      const changer = await pool.connect();
      try {
        await changer.query("SET statement_timeout = 1000");
        await changer.query(
          'UPDATE "GitHubWebhookFence" SET "ownerHash"=$1,"generation"=2 WHERE "deliveryId"=$2',
          [b, identity.deliveryId],
        );
      } finally {
        changer.release();
      }
      await holder.query("COMMIT");
      expect(await attempt).toBeInstanceOf(Error);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM "effect" WHERE generation=8',
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("reproduces that advisory lock order alone can commit a stale serializable snapshot", async () => {
    const writer = await pool.connect();
    const reader = await pool.connect();
    try {
      await writer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await writer.query("SELECT pg_advisory_xact_lock(239891)");
      await writer.query('UPDATE "scope_authority" SET version = 2');
      await reader.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const waiting = reader.query("SELECT pg_advisory_xact_lock(239891)");
      await waitForAdvisoryWait(pool, 239891);
      await writer.query("COMMIT");
      await waiting;
      const seen = (await reader.query('SELECT version FROM "scope_authority"'))
        .rows[0].version;
      await reader.query('INSERT INTO "effect" VALUES ($1)', [seen + 20]);
      await reader.query("COMMIT");
      expect(seen).toBe(1);
      expect(
        (await pool.query('SELECT version FROM "scope_authority"')).rows[0]
          .version,
      ).toBe(2);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM "effect" WHERE generation=21',
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await reader.query("ROLLBACK").catch(() => undefined);
      writer.release();
      reader.release();
    }
  });

  it("reads current authority after a lock wait with ReadCommitted", async () => {
    await pool.query('UPDATE "scope_authority" SET version = 1');
    const writer = await pool.connect();
    const reader = await pool.connect();
    try {
      await writer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await writer.query("SELECT pg_advisory_xact_lock(239892)");
      await writer.query('UPDATE "scope_authority" SET version = 2');
      await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const waiting = reader.query("SELECT pg_advisory_xact_lock(239892)");
      await waitForAdvisoryWait(pool, 239892);
      await writer.query("COMMIT");
      await waiting;
      expect(
        (await reader.query('SELECT version FROM "scope_authority"')).rows[0]
          .version,
      ).toBe(2);
      await reader.query("COMMIT");
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await reader.query("ROLLBACK").catch(() => undefined);
      writer.release();
      reader.release();
    }
  });

  it("rejects missing fences, live takeovers and invalid claims", async () => {
    await expect(
      runWebhookFencedDatabaseEffect(
        prisma,
        {
          deliveryId: "legacy-without-fence",
          ownerHash: a,
          appIdentityHash: "d".repeat(64),
          generation: 1n,
        },
        async () => undefined,
      ),
    ).rejects.toThrow("webhook_fence_missing");
    await expect(
      reclaimWebhookFence(
        prisma,
        {
          deliveryId,
          ownerHash: a,
          appIdentityHash: "d".repeat(64),
          generation: 1n,
        },
        b,
        10000,
      ),
    ).resolves.toBeNull();
    await expect(
      reclaimWebhookFence(
        prisma,
        {
          deliveryId,
          ownerHash: a,
          appIdentityHash: "d".repeat(64),
          generation: 1n,
        },
        a,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_invalid");
  });

  it("creates a fence atomically and never renews an expired generation", async () => {
    const delivery = { deliveryId: "new-delivery", eventName: "pull_request" };
    const claim = await beginFencedWebhookDelivery(
      prisma,
      delivery,
      a,
      10000,
      "d".repeat(64),
    );
    expect(claim.generation).toBe(1n);
    expect(await renewWebhookFence(prisma, claim, 10000)).toBe(true);
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    expect(await renewWebhookFence(prisma, claim, 10000)).toBe(false);
    await expect(
      beginFencedWebhookDelivery(prisma, delivery, b, 10000, "d".repeat(64)),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "GitHubWebhookFence" WHERE "deliveryId"=$1',
          [delivery.deliveryId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("serializes concurrent work and fences the previous generation", async () => {
    const takeoverConnection = await pool.connect();
    let entered!: (backendPid: number) => void;
    let release!: () => void;
    const enteredPromise = new Promise<number>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWebhookFencedDatabaseEffect(
      realPrisma,
      {
        deliveryId,
        ownerHash: a,
        appIdentityHash: "d".repeat(64),
        generation: 1n,
      },
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>(
          Prisma.sql`SELECT pg_backend_pid() AS pid`,
        );
        if (!rows[0]) throw new Error("effect_backend_missing");
        entered(rows[0].pid);
        await gate;
        await tx.$queryRaw(
          Prisma.sql`INSERT INTO "effect" VALUES (1) RETURNING generation`,
        );
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    let takeover: Promise<unknown> = Promise.resolve(null);
    try {
      const ownerPid = await Promise.race([
        enteredPromise,
        first.then((error) => {
          throw error ?? new Error("effect_barrier_not_reached");
        }),
      ]);
      const rows = await takeoverConnection.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const takeoverPid = rows.rows[0]?.pid;
      if (takeoverPid === undefined)
        throw new Error("takeover_backend_missing");
      takeover = takeoverConnection
        .query(
          'UPDATE "GitHubWebhookFence" SET "ownerHash"=$1,"generation"=2 WHERE "deliveryId"=$2',
          [b, deliveryId],
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      let blocked = false;
      for (let attempt = 0; attempt < 80 && !blocked; attempt++) {
        const result = await Promise.race([
          pool.query<{ blocked: boolean }>(
            "SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked",
            [ownerPid, takeoverPid],
          ),
          first.then((error) => {
            throw error ?? new Error("effect_released_before_blocker");
          }),
          takeover.then((error) => {
            throw error ?? new Error("takeover_did_not_wait");
          }),
        ]);
        blocked = result.rows[0]?.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      release();
      expect(await first).toBeNull();
      expect(await takeover).toBeNull();
    } finally {
      release();
      await first;
      await takeover;
      takeoverConnection.release();
    }
    await expect(
      runWebhookFencedDatabaseEffect(
        realPrisma,
        {
          deliveryId,
          ownerHash: a,
          appIdentityHash: "d".repeat(64),
          generation: 1n,
        },
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`INSERT INTO "effect" VALUES (3) RETURNING generation`,
          );
        },
      ),
    ).rejects.toThrow("webhook_fence_stale");
    await runWebhookFencedDatabaseEffect(
      realPrisma,
      {
        deliveryId,
        ownerHash: b,
        appIdentityHash: "d".repeat(64),
        generation: 2n,
      },
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`INSERT INTO "effect" VALUES (2) RETURNING generation`,
        );
      },
    );
    expect(
      (
        await pool.query(
          'SELECT generation FROM "effect" WHERE generation IN (1,2,3) ORDER BY generation',
        )
      ).rows.map((row) => row.generation),
    ).toEqual(["1", "2"]);
  });

  it("rolls back the transaction if the lease expires during an effect", async () => {
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()+interval \'100 milliseconds\' WHERE "deliveryId"=$1',
      [deliveryId],
    );
    await expect(
      runWebhookFencedDatabaseEffect(
        prisma,
        {
          deliveryId,
          ownerHash: b,
          appIdentityHash: "d".repeat(64),
          generation: 2n,
        },
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`INSERT INTO "effect" VALUES (4) RETURNING generation`,
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      ),
    ).rejects.toThrow("webhook_fence_expired");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM "effect" WHERE generation=4',
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("lets only one claimant take over an expired generation", async () => {
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [deliveryId],
    );
    const previous = {
      deliveryId,
      ownerHash: b,
      appIdentityHash: "d".repeat(64),
      generation: 2n,
    };
    const outcomes = await Promise.all([
      reclaimWebhookFence(prisma, previous, "c".repeat(64), 10000),
      reclaimWebhookFence(prisma, previous, "d".repeat(64), 10000),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(outcomes.find(Boolean)?.generation).toBe(3n);
    const winner = outcomes.find((outcome) => outcome !== null)!;
    await runWebhookFencedDatabaseEffect(
      prisma,
      winner,
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          UPDATE "GitHubWebhookDelivery" SET status = 'processed'
          WHERE "deliveryId" = ${deliveryId} RETURNING status
        `);
      },
      "processed",
    );
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [deliveryId],
    );
    expect(
      await reclaimWebhookFence(prisma, winner, "e".repeat(64), 10000),
    ).toBeNull();
    expect(await renewWebhookFence(prisma, winner, 10000)).toBe(false);
  });
});

async function waitForAdvisoryWait(pool: Pool, key: number): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const result = await pool.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1",
      [key],
    );
    if (result.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("advisory_wait_not_observed");
}
