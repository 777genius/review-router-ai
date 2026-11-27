import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaWorkspaceMembershipRepository } from "../infrastructure/prisma/prisma-workspace-membership-repository";
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
      INSERT INTO "User" (id) VALUES ('u1'),('u2'),('new');
      INSERT INTO "Workspace" (id,slug,name,"personalOwnerUserId") VALUES ('w1','s1','first','u1'),('w2','s2','second','u2');`);
    await pool.query(
      await readFile(
        new URL(
          "../../../../platform/db/prisma/migrations/000166_current_scope_epoch/migration.sql",
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
});
