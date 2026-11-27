import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
import { PrismaWorkspaceReviewSettings } from "@reviewrouter/features-review-config";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaWorkspaceMembershipRepository } from "@reviewrouter/features-auth";
import { PrismaPersonalAccountOperations } from "@reviewrouter/features-provider-accounts/synchronization";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("personal workspace scoped epochs on isolated PostgreSQL", () => {
  const schema = `personal_scope_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const principal = (id: string) => ({
    provider: "github" as const,
    userId: id,
    externalUserId: id,
    login: id,
    githubUserId: id,
    githubLogin: id,
    primaryEmail: null,
    avatarUrl: null,
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
      CREATE TABLE "User" (id TEXT PRIMARY KEY, "githubUserId" BIGINT UNIQUE, "githubLogin" TEXT, "primaryEmail" TEXT, "avatarUrl" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "Workspace" (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, "reviewDraftPullRequests" BOOLEAN DEFAULT true, "providerManagementAdminOnly" BOOLEAN DEFAULT false, "deletionState" "WorkspaceDeletionState" DEFAULT 'active', "deletionRevision" INT DEFAULT 1, "deletionTombstonedAt" TIMESTAMP(3), "personalOwnerUserId" TEXT UNIQUE, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "WorkspaceMember" (id TEXT PRIMARY KEY, "workspaceId" TEXT, "userId" TEXT, "githubLogin" TEXT, role "WorkspaceRole", "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, UNIQUE("workspaceId","userId"), UNIQUE("workspaceId","githubLogin"));
      INSERT INTO "User" (id) VALUES ('u1'),('u2'),('new'),('legacy'),('cross');
      INSERT INTO "Workspace" (id,slug,name,"personalOwnerUserId") VALUES ('w1','s1','first','u1'),('w2','s2','second','u2');`);
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
  it("concurrent first logins create exactly one workspace and member", async () => {
    const repo = new PrismaWorkspaceMembershipRepository(prisma);
    const results = await Promise.all([
      repo.ensurePersonalWorkspaceOwner(principal("new")),
      repo.ensurePersonalWorkspaceOwner(principal("new")),
    ]);
    expect(results[0]?.workspaceId).toBe(results[1]?.workspaceId);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "Workspace" WHERE "personalOwnerUserId"=\'new\'',
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "WorkspaceMember" WHERE "userId"=\'new\'',
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("concurrent auth and provider personal creation agree on one workspace", async () => {
    const auth = new PrismaWorkspaceMembershipRepository(prisma);
    const provider = new PrismaPersonalAccountOperations(prisma);
    const [membership, workspaceId] = await Promise.all([
      auth.ensurePersonalWorkspaceOwner(principal("cross")),
      provider.resolvePersonalWorkspace("cross"),
    ]);
    expect(membership.workspaceId).toBe(workspaceId);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "Workspace" WHERE "personalOwnerUserId"=\'cross\'',
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "WorkspaceMember" WHERE "userId"=\'cross\'',
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("records actual legacy first-login overlap with the scoped writer", async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id='legacy' FOR UPDATE`;
      const workspace = await tx.workspace.create({
        data: {
          slug: "old-legacy",
          name: "@legacy",
          personalOwnerUserId: "legacy",
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: "legacy",
          githubLogin: "legacy",
          role: "owner",
        },
      });
      entered();
      await gate;
    });
    await ready;
    const next = new PrismaWorkspaceMembershipRepository(prisma)
      .ensurePersonalWorkspaceOwner(principal("legacy"))
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      let blocked = false;
      for (let i = 0; i < 80 && !blocked; i++) {
        blocked =
          (
            await pool.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT%User%FOR UPDATE%'",
            )
          ).rows[0].n > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    await old;
    const outcome = await next;
    expect(outcome).toMatchObject({ value: { source: "personal" } });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM "Workspace" WHERE "personalOwnerUserId"=\'legacy\'',
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("different existing workspaces do not share an exclusive global lock", async () => {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM \"User\" WHERE id='u1' FOR UPDATE");
    const repo = new PrismaWorkspaceMembershipRepository(prisma);
    const waiting = repo.ensurePersonalWorkspaceOwner(principal("u1"));
    try {
      let blocked = false;
      for (let i = 0; i < 80 && !blocked; i++) {
        blocked =
          (
            await pool.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT%User%FOR UPDATE%'",
            )
          ).rows[0].n > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);
      const other = await Promise.race([
        repo.ensurePersonalWorkspaceOwner(principal("u2")),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("different workspace blocked")),
            2000,
          ),
        ),
      ]);
      expect(other.workspaceId).toBe("w2");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect((await waiting).workspaceId).toBe("w1");
  });
  it("review setting writer and fenced reader agree after a real lock wait", async () => {
    await pool.query(
      `CREATE FUNCTION synthetic_hold_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87892145); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER synthetic_settings BEFORE UPDATE ON "Workspace" FOR EACH ROW EXECUTE FUNCTION synthetic_hold_settings()`,
    );
    const blocker = await pool.connect();
    await blocker.query("SELECT pg_advisory_lock(87892145)");
    const writer = new PrismaWorkspaceReviewSettings(prisma).save("w1", false);
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
      reader = runScopeEpochSerializableTransaction(
        prisma,
        [{ scope: "workspace", workspaceId: "w1", mode: "shared" }],
        (tx) => new PrismaWorkspaceReviewSettings(tx).reviewDrafts("w1"),
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
      await blocker.query("SELECT pg_advisory_unlock(87892145)");
      blocker.release();
    }
    await writer;
    expect(await reader).toBe(false);
    await pool.query('DROP TRIGGER synthetic_settings ON "Workspace"');
  });

  it("retries global reader after a converted workspace writer", async () => {
    await pool.query(
      `CREATE FUNCTION synthetic_hold_global_reader() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(87892146); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER synthetic_global_reader BEFORE UPDATE ON "Workspace" FOR EACH ROW EXECUTE FUNCTION synthetic_hold_global_reader()`,
    );
    const blocker = await pool.connect();
    await blocker.query("SELECT pg_advisory_lock(87892146)");
    const writer = new PrismaWorkspaceReviewSettings(prisma).save("w1", true);
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
        (tx) => new PrismaWorkspaceReviewSettings(tx).reviewDrafts("w1"),
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
      await blocker.query("SELECT pg_advisory_unlock(87892146)");
      blocker.release();
    }
    await writer;
    expect(await reader).toBe(true);
    expect(attempts).toBeGreaterThan(1);
    expect(
      (
        await prisma.workspace.findUniqueOrThrow({
          where: { id: "w1" },
          select: { reviewDraftPullRequests: true },
        })
      ).reviewDraftPullRequests,
    ).toBe(true);
    await pool.query('DROP TRIGGER synthetic_global_reader ON "Workspace"');
  });
});
