import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaWorkspaceProviderProfileRepository } from "@reviewrouter/features-review-config/composition";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("workspace access rights epoch on isolated PostgreSQL", () => {
  const schema = `rights_epoch_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const input = (adminOnly: boolean) => ({
    workspaceId: "w",
    actor: { userId: "u", auditActor: "synthetic" },
    adminOnly,
    authorize: (facts: { actor: { role: string | null } }) => {
      if (facts.actor.role !== "owner") throw new Error("forbidden");
    },
  });
  beforeAll(async () => {
    if (
      !socket?.startsWith("/") ||
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
        "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TYPE "WorkspaceRole" AS ENUM ('owner','admin','member'); CREATE TYPE "WorkspaceDeletionState" AS ENUM ('active','delete_pending','deleted');
      CREATE TABLE "Workspace" (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, "reviewDraftPullRequests" BOOLEAN DEFAULT true, "providerManagementAdminOnly" BOOLEAN DEFAULT false, "deletionState" "WorkspaceDeletionState" DEFAULT 'active', "deletionRevision" INT DEFAULT 1, "deletionTombstonedAt" TIMESTAMP(3), "personalOwnerUserId" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "WorkspaceMember" (id TEXT PRIMARY KEY, "workspaceId" TEXT, "userId" TEXT, "githubLogin" TEXT, role "WorkspaceRole", "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "AuditEvent" (id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, metadata JSONB NOT NULL, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (id,slug,name) VALUES ('w','synthetic','Synthetic'); INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role) VALUES ('m','w','u','owner');`);
    await pool.query(
      await readFile(
        new URL(
          "../../../../packages/platform/db/prisma/migrations/000166_current_scope_epoch/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  it("commits access rights, audit and scoped epoch together", async () => {
    const store = new PrismaWorkspaceProviderProfileRepository(prisma, {
      operatorWorkspaceId: undefined,
      personalAccountsEnabled: false,
    });
    expect(await store.changeAccessRights(input(true))).toEqual({
      adminOnly: true,
      previous: false,
    });
    expect(
      (
        await pool.query(
          'SELECT "providerManagementAdminOnly" FROM "Workspace" WHERE id=\'w\'',
        )
      ).rows[0].providerManagementAdminOnly,
    ).toBe(true);
    expect(
      (await pool.query('SELECT count(*)::int n FROM "AuditEvent"')).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(1);
  });
  it("rolls back setting and epoch when audit write fails", async () => {
    await pool.query(
      "ALTER TABLE \"AuditEvent\" ADD CONSTRAINT synthetic_reject CHECK (action <> 'workspace.access_rights_saved') NOT VALID",
    );
    const before = (
      await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"')
    ).rows[0].n;
    const store = new PrismaWorkspaceProviderProfileRepository(prisma, {
      operatorWorkspaceId: undefined,
      personalAccountsEnabled: false,
    });
    await expect(store.changeAccessRights(input(false))).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT "providerManagementAdminOnly" FROM "Workspace" WHERE id=\'w\'',
        )
      ).rows[0].providerManagementAdminOnly,
    ).toBe(true);
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(before);
  });
  it("retries a global reader waiting on the real access-rights writer", async () => {
    await pool.query(
      'ALTER TABLE "AuditEvent" DROP CONSTRAINT synthetic_reject',
    );
    await pool.query(
      `CREATE FUNCTION synthetic_hold_rights() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87892148); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER synthetic_hold BEFORE UPDATE ON "Workspace" FOR EACH ROW EXECUTE FUNCTION synthetic_hold_rights()`,
    );
    const blocker = await pool.connect();
    await blocker.query("SELECT pg_advisory_lock(87892148)");
    const store = new PrismaWorkspaceProviderProfileRepository(prisma, {
      operatorWorkspaceId: undefined,
      personalAccountsEnabled: false,
    });
    const writer = store.changeAccessRights(input(false));
    let reader: Promise<boolean> | undefined;
    let attempts = 0;
    try {
      let waiting = 0;
      for (let i = 0; i < 80 && waiting < 1; i++) {
        waiting = (
          await pool.query(
            "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0].n;
        if (waiting < 1) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(1);
      const counting = {
        $transaction: (
          fn: (tx: Prisma.TransactionClient) => Promise<boolean>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) => {
          attempts++;
          return prisma.$transaction(fn, options);
        },
      } as unknown as PrismaClient;
      reader = runScopeEpochSerializableTransaction(
        counting,
        [{ scope: "global", mode: "exclusive" }],
        async (tx) =>
          (
            await tx.workspace.findUniqueOrThrow({
              where: { id: "w" },
              select: { providerManagementAdminOnly: true },
            })
          ).providerManagementAdminOnly,
      );
      for (let i = 0; i < 80 && waiting < 2; i++) {
        waiting = (
          await pool.query(
            "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
          )
        ).rows[0].n;
        if (waiting < 2) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(87892148)");
      blocker.release();
    }
    await writer;
    expect(await reader).toBe(false);
    expect(attempts).toBeGreaterThan(1);
  });
});
