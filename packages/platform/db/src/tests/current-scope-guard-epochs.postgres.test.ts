import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { acquireCurrentScopeGuards } from "../current-scope-guards";
import {
  acquireCurrentScopeGuardsWithEpoch,
  runScopeEpochSerializableTransaction,
} from "../current-scope-guard-epochs";

const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("experimental current scope epoch on isolated PostgreSQL", () => {
  const schema = `scope_epoch_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  beforeAll(async () => {
    if (
      !socket?.startsWith("/") ||
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
        "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      await readFile(
        new URL(
          "../../prisma/migrations/000166_current_scope_epoch/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pool.query('CREATE TABLE "authority" (version int NOT NULL)');
    await pool.query('INSERT INTO "authority" VALUES (1)');
    const key = createHash("sha256")
      .update("review-current-scope-v1\0global")
      .digest("hex");
    await pool.query('INSERT INTO "CurrentScopeEpoch" ("keyHash") VALUES($1)', [
      key,
    ]);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("documents unsafe stale effect when a legacy writer omits the epoch", async () => {
    await pool.query('CREATE TABLE "legacy_effect" (version int NOT NULL)');
    await pool.query('UPDATE "authority" SET version=10');
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuards(tx, [
          { scope: "global", mode: "exclusive" },
        ]);
        await tx.$executeRaw(Prisma.sql`UPDATE "authority" SET version=11`);
        entered();
        await gate;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await ready;
    const reader = runScopeEpochSerializableTransaction(
      prisma,
      [{ scope: "global", mode: "shared" }],
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ version: number }>>(
          Prisma.sql`SELECT version FROM "authority"`,
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "legacy_effect" (version) VALUES (${rows[0]!.version})`,
        );
        return rows[0]!.version;
      },
    );
    try {
      let waiting = false;
      for (let i = 0; i < 80 && !waiting; i++) {
        waiting =
          (
            await pool.query(
              "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            )
          ).rows[0].n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await writer;
    expect(await reader).toBe(10);
    expect(
      (await pool.query('SELECT version FROM "authority"')).rows[0].version,
    ).toBe(11);
    expect(
      (await pool.query('SELECT version FROM "legacy_effect"')).rows[0].version,
    ).toBe(10);
  });

  it("rejects a serializable snapshot from before the authority writer commits", async () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const writer = prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuardsWithEpoch(tx, [
          { scope: "global", mode: "exclusive" },
        ]);
        await tx.$executeRaw(Prisma.sql`UPDATE "authority" SET version=2`);
        entered();
        await gate;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await enteredP;
    const pending = prisma
      .$transaction(
        async (tx) => {
          await acquireCurrentScopeGuardsWithEpoch(tx, [
            { scope: "global", mode: "shared" },
          ]);
          return tx.$queryRaw<Array<{ version: number }>>(
            Prisma.sql`SELECT version FROM "authority"`,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .then(
        (v) => ({ value: v }),
        (error) => ({ error }),
      );
    let waiting = false;
    for (let i = 0; i < 80 && !waiting; i++) {
      waiting =
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0].n > 0;
      if (!waiting) await new Promise((r) => setTimeout(r, 25));
    }
    expect(waiting).toBe(true);
    release();
    await writer;
    const outcome = await pending;
    expect(outcome).toMatchObject({
      error: {
        code: "P2010",
        meta: {
          driverAdapterError: {
            cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
          },
        },
      },
    });
    const fresh = await prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuardsWithEpoch(tx, [
          { scope: "global", mode: "shared" },
        ]);
        return tx.$queryRaw<Array<{ version: number }>>(
          Prisma.sql`SELECT version FROM "authority"`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(fresh[0]?.version).toBe(2);
  });

  it("retries the actual 40001 epoch conflict and observes fresh authority", async () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = prisma.$transaction(
      async (tx) => {
        await acquireCurrentScopeGuardsWithEpoch(tx, [
          { scope: "global", mode: "exclusive" },
        ]);
        await tx.$executeRaw(Prisma.sql`UPDATE "authority" SET version=3`);
        entered();
        await gate;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await enteredPromise;
    const reader = runScopeEpochSerializableTransaction(
      prisma,
      [{ scope: "global", mode: "shared" }],
      (tx) =>
        tx.$queryRaw<Array<{ version: number }>>(
          Prisma.sql`SELECT version FROM "authority"`,
        ),
    );
    let waiting = false;
    try {
      for (let i = 0; i < 80 && !waiting; i++) {
        waiting =
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
            )
          ).rows[0].n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await writer;
    expect((await reader)[0]?.version).toBe(3);
  });

  it("does not retry unrelated errors and bounds 40001 retries", async () => {
    const makeError = (code: string, originalCode: string) =>
      new Prisma.PrismaClientKnownRequestError("synthetic", {
        code,
        clientVersion: "7.9.0",
        meta: {
          driverAdapterError: {
            cause: { kind: "TransactionWriteConflict", originalCode },
          },
        },
      });
    for (const error of [
      makeError("P2010", "23505"),
      makeError("P2034", "40001"),
      new Error("network"),
    ]) {
      const run = vi.fn().mockRejectedValue(error);
      await expect(
        runScopeEpochSerializableTransaction(
          { $transaction: run } as never,
          [{ scope: "global", mode: "shared" }],
          async () => undefined,
        ),
      ).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    }
    const conflict = makeError("P2010", "40001");
    const run = vi.fn().mockRejectedValue(conflict);
    await expect(
      runScopeEpochSerializableTransaction(
        { $transaction: run } as never,
        [{ scope: "global", mode: "shared" }],
        async () => undefined,
      ),
    ).rejects.toBe(conflict);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("keeps different workspace writers concurrent under the shared global epoch", async () => {
    for (const workspaceId of ["workspace-a", "workspace-b"]) {
      const key = createHash("sha256")
        .update(`review-current-scope-v1\0workspace:${workspaceId}`)
        .digest("hex");
      await pool.query(
        'INSERT INTO "CurrentScopeEpoch" ("keyHash") VALUES($1)',
        [key],
      );
    }
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered = 0;
    const run = (id: string) =>
      prisma.$transaction(
        async (tx) => {
          await acquireCurrentScopeGuardsWithEpoch(tx, [
            { scope: "workspace", workspaceId: id, mode: "exclusive" },
          ]);
          entered++;
          await gate;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    const a = run("workspace-a"),
      b = run("workspace-b");
    try {
      for (let i = 0; i < 80 && entered < 2; i++)
        await new Promise((r) => setTimeout(r, 25));
      expect(entered).toBe(2);
    } finally {
      release();
    }
    await Promise.all([a, b]);
  });
});
