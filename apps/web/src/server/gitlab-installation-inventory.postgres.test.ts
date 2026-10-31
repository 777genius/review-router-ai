import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  GitLabBulkProvisionResult,
  GitLabGroupProject,
} from "@reviewrouter/features-gitlab-integration";
import { PrismaGitLabInstallationInventory } from "./gitlab-installation-inventory";

const adminUrl = process.env.GITLAB_INVENTORY_TEST_POSTGRES_ADMIN_URL;
if (process.env.GITLAB_INVENTORY_REQUIRE_POSTGRES === "1" && !adminUrl) {
  throw new Error("gitlab_inventory_postgres_fixture_required");
}

describe.skipIf(!adminUrl)("GitLab installation inventory on real PostgreSQL", () => {
  const databaseName = `TEST_gitlab_inventory_${randomUUID().replaceAll("-", "")}`;
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let inventory: PrismaGitLabInstallationInventory;
  let created = false;

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      throw new Error("disposable_loopback_database_required");
    }
    admin = createPrismaClient({ databaseUrl: adminUrl!, poolMax: 2 });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    prisma = createPrismaClient({
      databaseUrl: url.toString(),
      poolMax: 12,
      transactionMaxWaitMs: 10_000,
      transactionTimeoutMs: 15_000,
    });
    for (const statement of schema) {
      await prisma.$executeRawUnsafe(statement);
    }
    inventory = new PrismaGitLabInstallationInventory(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "RepositoryConnection", "GitLabInstallation" CASCADE',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Workspace" ("id") VALUES ('workspace_1'), ('workspace_2')
       ON CONFLICT ("id") DO NOTHING`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" ("id") VALUES ('user_1')
       ON CONFLICT ("id") DO NOTHING`,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    await admin?.$disconnect();
  });

  function project(id: string): GitLabGroupProject {
    return {
      projectId: id,
      fullName: `team/repository-${id}`,
      name: `repository-${id}`,
      defaultBranch: "main",
      webUrl: null,
      visibility: "private",
      archived: false,
    };
  }

  function provision(ids: readonly string[]): GitLabBulkProvisionResult {
    return {
      protocolVersion: 1,
      requested: ids.length,
      succeeded: ids.length,
      failed: 0,
      sharedVariablesConfigured: 0,
      results: ids.map((projectId) => ({
        projectId,
        status: "fulfilled" as const,
        result: {
          mode: "ci_config_path" as const,
          ciConfigPath: ".gitlab/reviewrouter.yml",
          variablesConfigured: 3,
        },
      })),
    };
  }

  function snapshot(
    workspaceId = "workspace_1",
    ids: readonly string[] = ["101"],
    requestStartedAt = new Date("2026-10-31T10:00:00.000Z"),
  ) {
    return {
      workspaceId,
      installedByUserId: "user_1",
      sourceBaseUrl: "https://gitlab.com",
      namespacePath: "team",
      sourceKind: "group" as const,
      requestStartedAt,
      selectedProjects: ids.map(project),
      provision: provision(ids),
    };
  }

  it("rolls back installation and previous changes when a later repository insert fails", async () => {
    await expect(inventory.record(snapshot("workspace_1", ["101", "999"]))).rejects.toThrow(
      "injected_repository_write_failure",
    );
    expect(await prisma.gitLabInstallation.count()).toBe(0);
    expect(await prisma.repositoryConnection.count()).toBe(0);
    await expect(inventory.record(snapshot())).resolves.toMatchObject({
      installationId: expect.any(String),
    });
    expect(await prisma.repositoryConnection.count()).toBe(1);
  });

  it("rolls back deselections and new repository inserts when an existing inventory update fails", async () => {
    const first = await inventory.record(snapshot("workspace_1", ["101"]));
    const before = await prisma.gitLabInstallation.findUniqueOrThrow({
      where: { id: first.installationId },
    });
    await expect(
      inventory.record(
        snapshot(
          "workspace_1",
          ["103", "999"],
          new Date("2026-10-31T10:00:01.000Z"),
        ),
      ),
    ).rejects.toThrow("injected_repository_write_failure");
    const after = await prisma.gitLabInstallation.findUniqueOrThrow({
      where: { id: first.installationId },
    });
    expect(after.installSummary).toEqual(before.installSummary);
    expect(after.selectedProjects).toBe(1);
    expect(after.lastInstalledAt).toEqual(before.lastInstalledAt);
    expect(await prisma.repositoryConnection.findMany()).toMatchObject([
      { externalRepositoryId: "101", selected: true },
    ]);
  });

  it("refuses a different workspace owner without any partial inventory commit", async () => {
    await inventory.record(snapshot("workspace_2", ["101"]));
    await expect(
      inventory.assertProjectsNotOwned({
        workspaceId: "workspace_1",
        sourceBaseUrl: "https://gitlab.com",
        projectIds: ["101"],
      }),
    ).rejects.toThrow("gitlab_repository_already_owned");
    await expect(
      inventory.record(snapshot("workspace_1", ["101"])),
    ).rejects.toThrow("gitlab_repository_already_owned");
    expect(await prisma.gitLabInstallation.count()).toBe(1);
    expect(await prisma.repositoryConnection.findFirstOrThrow()).toMatchObject({
      workspaceId: "workspace_2",
      selected: true,
    });
  });

  it("does not reserve another workspace's project for skipped read-only provisioning", async () => {
    const attempt = snapshot("workspace_1", ["101"]);
    await inventory.record({
      ...attempt,
      provision: {
        ...attempt.provision,
        results: [
          {
            projectId: "101",
            status: "fulfilled",
            result: {
              mode: "skipped",
              reason: "project_settings_permission_missing",
              lintErrors: [],
            },
          },
        ],
      },
    });
    expect(await prisma.repositoryConnection.count()).toBe(0);
    expect(
      (await prisma.gitLabInstallation.findFirstOrThrow({
        where: { workspaceId: "workspace_1" },
      })).status,
    ).toBe("permission_error");

    await expect(
      inventory.record(snapshot("workspace_2", ["101"])),
    ).resolves.toMatchObject({ installationId: expect.any(String) });
    expect(await prisma.repositoryConnection.findFirstOrThrow()).toMatchObject({
      workspaceId: "workspace_2",
      selected: true,
    });
  });

  it("applies a full replacement snapshot atomically and retains same-workspace ownership", async () => {
    const first = await inventory.record(snapshot("workspace_1", ["101", "103"]));
    await inventory.record(
      snapshot("workspace_1", ["103"], new Date("2026-10-31T10:00:01.000Z")),
    );
    expect(await prisma.gitLabInstallation.count()).toBe(1);
    expect(await prisma.repositoryConnection.count()).toBe(2);
    const repositories = await prisma.repositoryConnection.findMany({
      orderBy: { externalRepositoryId: "asc" },
    });
    expect(repositories.map((repository) => [repository.externalRepositoryId, repository.selected])).toEqual([
      ["101", false],
      ["103", true],
    ]);
    expect(repositories.every((repository) => repository.workspaceId === "workspace_1")).toBe(true);
    expect(repositories.every((repository) => repository.gitlabInstallationId === first.installationId)).toBe(true);
  });

  it("does not overwrite a newer committed install with late older network work", async () => {
    await inventory.record(
      snapshot("workspace_1", ["102"], new Date("2026-10-31T10:00:02.000Z")),
    );
    await expect(
      inventory.record(snapshot("workspace_1", ["101"], new Date("2026-10-31T10:00:01.000Z"))),
    ).rejects.toThrow("gitlab_install_superseded");
    expect(await prisma.repositoryConnection.findMany()).toMatchObject([
      { externalRepositoryId: "102", selected: true },
    ]);
  });

  it("serializes concurrent same-install writers without duplicate inventory rows", async () => {
    const timestamp = await inventory.requestStartedAt();
    await Promise.all(
      Array.from({ length: 6 }, () => inventory.record(snapshot("workspace_1", ["101"], timestamp))),
    );
    expect(await prisma.gitLabInstallation.count()).toBe(1);
    expect(await prisma.repositoryConnection.count()).toBe(1);
  });
});

// Minimal scalar/foreign-key and uniqueness fixture for the actual Prisma
// adapter and PostgreSQL transaction/advisory-lock semantics. This is not a
// migration rehearsal or evidence of provider-side effects.
const schema = [
  `CREATE TYPE "ScmProvider" AS ENUM ('github', 'gitlab')`,
  `CREATE TYPE "GitLabInstallationStatus" AS ENUM ('pending', 'active', 'removed', 'permission_error', 'sync_error')`,
  `CREATE TYPE "RepositoryVisibility" AS ENUM ('public', 'private', 'internal')`,
  `CREATE TYPE "RepositorySetupStatus" AS ENUM ('not_configured', 'setup_pr_open', 'configured', 'needs_attention')`,
  `CREATE TABLE "Workspace" ("id" text PRIMARY KEY)`,
  `CREATE TABLE "User" ("id" text PRIMARY KEY)`,
  `CREATE TABLE "GitLabInstallation" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
    "namespaceId" text, "sourceBaseUrl" text NOT NULL DEFAULT 'https://gitlab.com',
    "namespacePath" text NOT NULL, "sourceKind" text NOT NULL,
    "status" "GitLabInstallationStatus" NOT NULL DEFAULT 'active',
    "installedByUserId" text REFERENCES "User"("id") ON DELETE SET NULL,
    "selectedProjects" integer NOT NULL DEFAULT 0, "installSummary" jsonb,
    "lastInstalledAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL,
    UNIQUE ("workspaceId","sourceBaseUrl","namespacePath")
  )`,
  `CREATE TABLE "RepositoryConnection" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
    "provider" "ScmProvider" NOT NULL DEFAULT 'github',
    "sourceBaseUrl" text NOT NULL DEFAULT 'https://github.com',
    "externalRepositoryId" text NOT NULL, "scmRepositoryIdentityId" text,
    "installationId" text, "githubRepositoryId" bigint UNIQUE,
    "gitlabInstallationId" text REFERENCES "GitLabInstallation"("id") ON DELETE CASCADE,
    "owner" text NOT NULL, "name" text NOT NULL, "fullName" text NOT NULL,
    "defaultBranch" text NOT NULL, "visibility" "RepositoryVisibility" NOT NULL,
    "selected" boolean NOT NULL DEFAULT true, "archived" boolean NOT NULL DEFAULT false,
    "stargazersCount" integer NOT NULL DEFAULT 0,
    "setupStatus" "RepositorySetupStatus" NOT NULL DEFAULT 'not_configured',
    "inventoryGeneration" bigint NOT NULL DEFAULT 0,
    "lifecycleResolutionMode" text NOT NULL DEFAULT 'legacy_open',
    "lifecycleResolutionActivatedAt" timestamp(3),
    "lifecycleResolutionActivationVersion" integer NOT NULL DEFAULT 0,
    "lifecycleResolutionWriterDigest" text, "lifecycleResolutionBootstrapJson" jsonb,
    "lastSyncedAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL,
    UNIQUE ("provider","externalRepositoryId","sourceBaseUrl"),
    UNIQUE ("workspaceId","provider","fullName","sourceBaseUrl"),
    UNIQUE ("id","workspaceId"), UNIQUE ("id","workspaceId","scmRepositoryIdentityId")
  )`,
  `CREATE FUNCTION reject_project_999() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."externalRepositoryId" = '999' AND NEW."workspaceId" = 'workspace_1' THEN
        RAISE EXCEPTION 'injected_repository_write_failure';
      END IF;
      RETURN NEW;
    END
  $$`,
  `CREATE TRIGGER reject_project_999 BEFORE INSERT ON "RepositoryConnection"
    FOR EACH ROW EXECUTE FUNCTION reject_project_999()`,
];
