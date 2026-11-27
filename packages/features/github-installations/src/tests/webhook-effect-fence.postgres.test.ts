import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
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
      'CREATE TABLE "GitHubWebhookDelivery" ("deliveryId" TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT \'processing\')',
    );
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
      'INSERT INTO "GitHubWebhookDelivery" ("deliveryId") VALUES ($1)',
      [deliveryId],
    );
    await pool.query(
      "INSERT INTO \"GitHubWebhookFence\" VALUES ($1,$2,1,clock_timestamp()+interval '1 minute')",
      [deliveryId, a],
    );
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it("rejects missing fences, live takeovers and invalid claims", async () => {
    await expect(
      runWebhookFencedDatabaseEffect(
        prisma,
        { deliveryId: "legacy-without-fence", ownerHash: a, generation: 1n },
        async () => undefined,
      ),
    ).rejects.toThrow("webhook_fence_missing");
    await expect(
      reclaimWebhookFence(
        prisma,
        { deliveryId, ownerHash: a, generation: 1n },
        b,
        10000,
      ),
    ).resolves.toBeNull();
    await expect(
      reclaimWebhookFence(
        prisma,
        { deliveryId, ownerHash: a, generation: 1n },
        a,
        10000,
      ),
    ).rejects.toThrow("webhook_fence_invalid");
  });

  it("creates a fence atomically and never renews an expired generation", async () => {
    const delivery = { deliveryId: "new-delivery", eventName: "pull_request" };
    const claim = await beginFencedWebhookDelivery(prisma, delivery, a, 10000);
    expect(claim.generation).toBe(1n);
    expect(await renewWebhookFence(prisma, claim, 10000)).toBe(true);
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval \'1 second\' WHERE "deliveryId"=$1',
      [delivery.deliveryId],
    );
    expect(await renewWebhookFence(prisma, claim, 10000)).toBe(false);
    await expect(
      beginFencedWebhookDelivery(prisma, delivery, b, 10000),
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
      { deliveryId, ownerHash: a, generation: 1n },
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
        { deliveryId, ownerHash: a, generation: 1n },
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`INSERT INTO "effect" VALUES (3) RETURNING generation`,
          );
        },
      ),
    ).rejects.toThrow("webhook_fence_stale");
    await runWebhookFencedDatabaseEffect(
      prisma,
      { deliveryId, ownerHash: b, generation: 2n },
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`INSERT INTO "effect" VALUES (2) RETURNING generation`,
        );
      },
    );
    expect(
      (
        await pool.query('SELECT generation FROM "effect" ORDER BY generation')
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
        { deliveryId, ownerHash: b, generation: 2n },
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
    const previous = { deliveryId, ownerHash: b, generation: 2n };
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
