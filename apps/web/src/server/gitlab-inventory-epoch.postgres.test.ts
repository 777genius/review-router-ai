import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaGitLabInstallationInventory } from "./gitlab-installation-inventory";
const socket = process.env.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
const test = socket?.startsWith("/") ? describe : describe.skip;
test("GitLab inventory scope epoch on isolated PostgreSQL", () => {
  const schema = `gitlab_epoch_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({
    host: socket,
    user: "postgres",
    database: "rr_webhook_fence_test",
    options: `-c search_path=${schema}`,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const input = {
    workspaceId: "w",
    installedByUserId: "u",
    sourceBaseUrl: "https://gitlab.example",
    namespacePath: "team",
    sourceKind: "group" as const,
    requestStartedAt: new Date("2026-01-01"),
    selectedProjects: [],
    provision: {
      protocolVersion: 1 as const,
      requested: 0,
      succeeded: 0,
      failed: 0,
      sharedVariablesConfigured: 0,
      results: [],
    },
  };
  beforeAll(async () => {
    if (
      !socket?.startsWith("/") ||
      (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
        "rr_webhook_fence_test"
    )
      throw new Error("disposable_test_database_required");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TYPE "GitLabInstallationStatus" AS ENUM ('active','permission_error'); CREATE TYPE "ScmProvider" AS ENUM ('github','gitlab');
      CREATE TABLE "GitLabInstallation" (id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "namespaceId" TEXT, "sourceBaseUrl" TEXT NOT NULL, "namespacePath" TEXT NOT NULL, "sourceKind" TEXT NOT NULL, status "GitLabInstallationStatus" DEFAULT 'active', "installedByUserId" TEXT, "selectedProjects" INT DEFAULT 0, "installSummary" JSONB, "lastInstalledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, UNIQUE("workspaceId","sourceBaseUrl","namespacePath"));
      CREATE TABLE "RepositoryConnection" (id TEXT PRIMARY KEY, "workspaceId" TEXT, provider "ScmProvider", "gitlabInstallationId" TEXT, "externalRepositoryId" TEXT, selected BOOLEAN, "lastSyncedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO "GitLabInstallation" (id,"workspaceId","sourceBaseUrl","namespacePath","sourceKind") VALUES ('i','w','https://gitlab.example','team','group');
      INSERT INTO "RepositoryConnection" (id,"workspaceId",provider,"gitlabInstallationId","externalRepositoryId",selected) VALUES ('r','w','gitlab','i','1',true);`);
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
  it("commits installation, deselection, and scope epoch together", async () => {
    expect(
      await new PrismaGitLabInstallationInventory(prisma).record(input),
    ).toEqual({ installationId: "i" });
    expect(
      (await pool.query('SELECT selected FROM "RepositoryConnection"')).rows[0]
        .selected,
    ).toBe(false);
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(1);
  });
  it("rolls back installation and epoch when a later write fails", async () => {
    await pool.query('UPDATE "RepositoryConnection" SET selected=true');
    await pool.query(
      'ALTER TABLE "RepositoryConnection" ADD CONSTRAINT synthetic_no_deselect CHECK (selected = true)',
    );
    const before = (
      await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"')
    ).rows[0].n;
    await expect(
      new PrismaGitLabInstallationInventory(prisma).record({
        ...input,
        requestStartedAt: new Date("2026-01-02"),
      }),
    ).rejects.toThrow();
    expect(
      (await pool.query('SELECT selected FROM "RepositoryConnection"')).rows[0]
        .selected,
    ).toBe(true);
    expect(
      (
        await pool.query('SELECT "lastInstalledAt" FROM "GitLabInstallation"')
      ).rows[0].lastInstalledAt.toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(
      (await pool.query('SELECT sum(revision)::int n FROM "CurrentScopeEpoch"'))
        .rows[0].n,
    ).toBe(before);
  });
});
