import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginFencedWebhookDelivery,
  runWebhookFencedDatabaseEffect,
} from "../../packages/features/github-installations/src/infrastructure/prisma/webhook-effect-fence";
import { PrismaWebhookDeliveryRepository } from "../../packages/features/github-installations/src/infrastructure/prisma/prisma-webhook-delivery-repository";
import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "./postgres-fixture";
const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("full migration webhook fencing compatibility", () => {
  const pool = new Pool(webhookFencePostgres.connection);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const role = `webhook_fence_test_${randomBytes(6).toString("hex")}`;
  const createdRoles: string[] = [];
  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    try {
      for (const createdRole of createdRoles) {
        await pool.query(`DROP OWNED BY "${createdRole}"`);
        await pool.query(`DROP ROLE "${createdRole}"`);
      }
    } finally {
      await pool.end();
    }
  });
  it("applies every checked-in migration with its exact checksum", async () => {
    const directory = new URL(
      "../../packages/platform/db/prisma/migrations/",
      import.meta.url,
    );
    const expected = readdirSync(directory)
      .filter((name) => /^\d{6}_/u.test(name))
      .sort()
      .map((name) => ({
        name,
        checksum: createHash("sha256")
          .update(readFileSync(new URL(`${name}/migration.sql`, directory)))
          .digest("hex"),
      }));
    const ledger = await pool.query(
      `SELECT migration_name AS name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    expect(ledger.rows).toEqual(expected);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
        )
      ).rows[0]?.count,
    ).toBe(0);
  });
  it("preserves a pre-migration legacy receipt without granting takeover", async () => {
    const id = "webhook-fence-migration-legacy";
    const legacy = new PrismaWebhookDeliveryRepository(prisma);
    expect(
      (
        await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: id },
        })
      ).status,
    ).toBe("processing");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "GitHubWebhookFence" WHERE "deliveryId"=$1',
          [id],
        )
      ).rows[0]?.count,
    ).toBe(0);
    await legacy.markFailed({
      deliveryId: id,
      errorSummary: "synthetic legacy failure",
    });
    expect(
      await legacy.tryStartProcessing({ deliveryId: id, eventName: "push" }),
    ).toBe(true);
    await legacy.markProcessed(id);
    expect(
      (
        await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: id },
        })
      ).status,
    ).toBe("processed");
  });
  it("enforces migration-only owner, generation and recovery-state constraints", async () => {
    const id = `migration-constraint-${randomBytes(6).toString("hex")}`;
    await prisma.gitHubWebhookDelivery.create({
      data: { deliveryId: id, eventName: "push" },
    });
    for (const [owner, generation] of [
      ["invalid", 1],
      ["a".repeat(64), 0],
    ] as const) {
      await expect(
        pool.query(
          `INSERT INTO "GitHubWebhookFence" ("deliveryId","ownerHash","appIdentityHash",generation,"leaseUntil") VALUES ($1,$2,$3,$4,clock_timestamp()+interval '1 minute')`,
          [id, owner, "d".repeat(64), generation],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      pool.query(
        `INSERT INTO "GitHubWebhookRecoveryIntent" ("appIdentityHash","deliveryGuid","githubDeliveryId","eventName","payloadHash",state) VALUES ($1,$2,1,'push',$3,'accepted')`,
        ["d".repeat(64), id, "e".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("allows guarded effects under a non-superuser role and rejects legacy overwrites", async () => {
    const password = randomBytes(24).toString("hex");
    await pool.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`,
    );
    createdRoles.push(role);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE ON "GitHubWebhookDelivery", "GitHubWebhookFence" TO "${role}"`,
    );
    const configuration = {
      ...webhookFencePostgres.connection,
      user: role,
      password,
    };
    if (configuration.connectionString) {
      const url = new URL(configuration.connectionString);
      url.username = role;
      url.password = password;
      configuration.connectionString = url.href;
    }
    const limitedPool = new Pool(configuration);
    const limited = new PrismaClient({ adapter: new PrismaPg(limitedPool) });
    try {
      const actor = await limitedPool.query(
        "SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname=current_user",
      );
      expect(actor.rows[0]).toEqual({ name: role, rolsuper: false });
      const id = `role-qualified-${randomBytes(6).toString("hex")}`;
      const claim = await beginFencedWebhookDelivery(
        limited,
        { deliveryId: id, eventName: "push" },
        "a".repeat(64),
        30_000,
        "d".repeat(64),
      );
      await runWebhookFencedDatabaseEffect(
        limited,
        claim,
        async (transaction) => {
          await transaction.gitHubWebhookDelivery.update({
            where: { deliveryId: id },
            data: { status: "processed" },
          });
        },
        "processed",
      );
      await expect(
        limitedPool.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await limited.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: id },
          })
        ).status,
      ).toBe("processed");
    } finally {
      await limited.$disconnect();
      await limitedPool.end();
    }
  });
  it("requires a retained fence read grant for a legacy rollback writer", async () => {
    const legacyRole = `legacy_${role}`;
    await pool.query(
      `CREATE ROLE "${legacyRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
    createdRoles.push(legacyRole);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${legacyRole}"`);
    await pool.query(
      `GRANT SELECT, UPDATE ON "GitHubWebhookDelivery" TO "${legacyRole}"`,
    );
    const legacyId = `rollback-legacy-${randomBytes(6).toString("hex")}`;
    const fencedId = `rollback-fenced-${randomBytes(6).toString("hex")}`;
    await prisma.gitHubWebhookDelivery.create({
      data: { deliveryId: legacyId, eventName: "push" },
    });
    await beginFencedWebhookDelivery(
      prisma,
      { deliveryId: fencedId, eventName: "push" },
      "a".repeat(64),
      30_000,
      "d".repeat(64),
    );
    const connection = await pool.connect();
    try {
      await connection.query(`SET ROLE "${legacyRole}"`);
      await expect(
        connection.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
          [legacyId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await connection.query("RESET ROLE");
      await pool.query(
        `GRANT SELECT ON "GitHubWebhookFence" TO "${legacyRole}"`,
      );
      await connection.query(`SET ROLE "${legacyRole}"`);
      expect(
        (
          await connection.query(
            'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
            [legacyId],
          )
        ).rowCount,
      ).toBe(1);
      await expect(
        connection.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
          [fencedId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      try {
        await connection.query("RESET ROLE");
      } finally {
        connection.release();
      }
    }
  });
});
