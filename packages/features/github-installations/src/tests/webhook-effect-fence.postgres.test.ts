import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  reclaimWebhookFence,
  renewWebhookFence,
  runWebhookFencedDatabaseEffect,
} from "../infrastructure/prisma/webhook-effect-fence";

// Explicitly opt into a disposable Unix-socket database. This test never
// connects to an application's configured DATABASE_URL.
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;

test("webhook database-effect fencing in isolated PostgreSQL", () => {
  const schema = `webhook_fence_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
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
    if (!socket?.startsWith("/")) throw new Error("test_socket_required");
    const { rows } = await pool.query("SELECT current_database() AS name");
    if (rows[0]?.name !== "rr_webhook_fence_test")
      throw new Error("disposable_test_database_required");
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
    await pool.query('CREATE TABLE "scope_epoch" (version integer NOT NULL)');
    await pool.query('INSERT INTO "scope_authority" VALUES (1)');
    await pool.query('INSERT INTO "scope_epoch" VALUES (1)');
    await pool.query(
      'INSERT INTO "GitHubWebhookDelivery" ("deliveryId") VALUES ($1)',
      [deliveryId],
    );
    await pool.query(
      "INSERT INTO \"GitHubWebhookFence\" VALUES ($1,$2,$3,1,clock_timestamp()+interval '1 minute')",
      [deliveryId, a, "d".repeat(64)],
    );
  });
  afterAll(async () => {
    await realPrisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
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

  it("shows a shared MVCC epoch rejects that stale snapshot before an effect", async () => {
    await pool.query('UPDATE "scope_authority" SET version = 1');
    const writer = await pool.connect();
    const reader = await pool.connect();
    try {
      await writer.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await writer.query("SELECT pg_advisory_xact_lock(239892)");
      await writer.query('UPDATE "scope_authority" SET version = 2');
      await writer.query('UPDATE "scope_epoch" SET version = version + 1');
      await reader.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const waiting = reader.query("SELECT pg_advisory_xact_lock(239892)");
      await waitForAdvisoryWait(pool, 239892);
      await writer.query("COMMIT");
      await waiting;
      await expect(
        reader.query('SELECT version FROM "scope_epoch" FOR SHARE'),
      ).rejects.toMatchObject({ code: "40001" });
      await reader.query("ROLLBACK");
      await reader.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await reader.query("SELECT pg_advisory_xact_lock(239892)");
      await reader.query('SELECT version FROM "scope_epoch" FOR SHARE');
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
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWebhookFencedDatabaseEffect(
      prisma,
      {
        deliveryId,
        ownerHash: a,
        appIdentityHash: "d".repeat(64),
        generation: 1n,
      },
      async (tx) => {
        entered();
        await gate;
        await tx.$queryRaw(
          Prisma.sql`INSERT INTO "effect" VALUES (1) RETURNING generation`,
        );
      },
    );
    await enteredPromise;
    let taken = false;
    const takeover = pool
      .query(
        'UPDATE "GitHubWebhookFence" SET "ownerHash"=$1,"generation"=2 WHERE "deliveryId"=$2',
        [b, deliveryId],
      )
      .then(() => {
        taken = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(taken).toBe(false);
    release();
    await first;
    await takeover;
    await expect(
      runWebhookFencedDatabaseEffect(
        prisma,
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
      prisma,
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
