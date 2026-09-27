import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import {
  PrismaProviderApiKeyRepository,
  PrismaProviderApiKeyStore,
  PrismaProviderApiKeyWorkspaceGrantStore,
} from "./provider-api-keys";

type QueryResult = {
  readonly rows: readonly Record<string, unknown>[];
  readonly affectedRows: number;
};

async function applyProviderKeyFixtureMigrations(
  database: PGlite,
): Promise<void> {
  for (const name of ["000001_init", "000022_gitlab_source_connections"]) {
    const migration = await readFile(
      resolve(
        process.cwd(),
        "packages/platform/db/prisma/migrations",
        name,
        "migration.sql",
      ),
      "utf8",
    );
    await database.exec(migration);
  }
  await database.exec(`
    CREATE UNIQUE INDEX "RepositoryConnection_id_workspaceId_key"
      ON "RepositoryConnection"("id", "workspaceId");
  `);
  const migration = await readFile(
    resolve(
      process.cwd(),
      "packages/platform/db/prisma/migrations",
      "000110_provider_api_key_workspace_management",
      "migration.sql",
    ),
    "utf8",
  );
  await database.exec(migration);
}

describe("provider API key persistence", () => {
  it("keeps versioned writes durable and stale-safe under the app role", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE ROLE app LOGIN PASSWORD 'disposable-app-password';
      `);
      await applyProviderKeyFixtureMigrations(database);

      const privileges = await database.query<{
        readonly grant_table: boolean;
        readonly connection_table: boolean;
        readonly link_table: boolean;
      }>(`
        SELECT
          has_table_privilege('app', '"ProviderApiKeyWorkspaceGrant"', 'SELECT,INSERT,UPDATE,DELETE') AS grant_table,
          has_table_privilege('app', '"ProviderApiKeyConnection"', 'SELECT,INSERT,UPDATE,DELETE') AS connection_table,
          has_table_privilege('app', '"ProviderApiKeyRepositoryLink"', 'SELECT,INSERT,UPDATE,DELETE') AS link_table
      `);
      expect(privileges.rows).toEqual([
        {
          grant_table: true,
          connection_table: true,
          link_table: true,
        },
      ]);

      await database.exec(`
        INSERT INTO "Workspace" ("id", "slug", "name", "updatedAt") VALUES
          ('workspace_1', 'workspace-one', 'Workspace One', NOW()),
          ('workspace_2', 'workspace-two', 'Workspace Two', NOW());
        INSERT INTO "GitHubInstallation" (
          "id", "workspaceId", "githubInstallationId", "accountLogin", "accountType",
          "repositorySelection", "updatedAt"
        ) VALUES
          ('installation_1', 'workspace_1', 101, 'acme', 'Organization', 'selected', NOW()),
          ('installation_2', 'workspace_2', 102, 'other', 'Organization', 'selected', NOW());
        INSERT INTO "RepositoryConnection" (
          "id", "workspaceId", "externalRepositoryId", "installationId", "githubRepositoryId",
          "owner", "name", "fullName", "defaultBranch", "visibility", "archived", "updatedAt"
        ) VALUES
          ('repo_1', 'workspace_1', 'external_1', 'installation_1', 201, 'acme', 'one', 'acme/one', 'main', 'public', false, NOW()),
          ('repo_2', 'workspace_2', 'external_2', 'installation_2', 202, 'other', 'two', 'other/two', 'main', 'public', false, NOW()),
          ('repo_3', 'workspace_1', 'external_3', 'installation_1', 203, 'acme', 'archived', 'acme/archived', 'main', 'public', true, NOW()),
          ('repo_4', 'workspace_1', 'external_4', 'installation_2', 204, 'other', 'foreign', 'other/foreign', 'main', 'public', false, NOW());

      `);

      const allowedRepositories = await database.query<{
        readonly id: string;
      }>(`
        SELECT id
        FROM "RepositoryConnection"
        WHERE "workspaceId" = 'workspace_1'
          AND provider = 'github'
          AND id IN ('repo_1', 'repo_2', 'repo_3', 'repo_4')
          AND archived = false
          AND "githubRepositoryId" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "GitHubInstallation"
            WHERE "GitHubInstallation".id = "RepositoryConnection"."installationId"
              AND "GitHubInstallation"."workspaceId" = "RepositoryConnection"."workspaceId"
              AND "GitHubInstallation".status = 'active'
          )
        ORDER BY id
      `);
      expect(allowedRepositories.rows).toEqual([{ id: "repo_1" }]);

      await database.exec(`
        SET ROLE app;
        INSERT INTO "ProviderApiKeyWorkspaceGrant" (
          "id", "workspaceId", "grantedBy", "grantReason", "updatedAt"
        ) VALUES (
          'grant_1', 'workspace_1', 'operator:test', 'disposable integration test', NOW()
        );
        INSERT INTO "ProviderApiKeyConnection" (
          "id", "workspaceId", "providerType", "encryptedApiKey", "keyVersion", "latestOperationId", "updatedAt"
        ) VALUES (
          'connection_1', 'workspace_1', 'mimo', 'ciphertext-only', 1, 'operation_1', NOW()
        );
        INSERT INTO "ProviderApiKeyRepositoryLink" (
          "id", "workspaceId", "providerApiKeyConnectionId", "repositoryId", "status", "operationId",
          "attemptedKeyVersion", "appliedKeyVersion", "attemptCount", "appliedAt", "updatedAt"
        ) VALUES (
          'link_1', 'workspace_1', 'connection_1', 'repo_1', 'applied', 'operation_1',
          1, 1, 1, NOW(), NOW()
        );
      `);

      await expect(
        database.query<QueryResult>(`
          INSERT INTO "ProviderApiKeyRepositoryLink" (
            "id", "workspaceId", "providerApiKeyConnectionId", "repositoryId",
            "attemptedKeyVersion", "updatedAt"
          ) VALUES (
            'foreign_repository_link', 'workspace_1', 'connection_1', 'repo_2',
            1, NOW()
          );
        `),
      ).rejects.toThrow(
        /ProviderApiKeyRepositoryLink_repository_workspace_fkey/,
      );
      await expect(
        database.query<QueryResult>(`
          INSERT INTO "ProviderApiKeyRepositoryLink" (
            "id", "workspaceId", "providerApiKeyConnectionId", "repositoryId",
            "attemptedKeyVersion", "updatedAt"
          ) VALUES (
            'foreign_connection_link', 'workspace_2', 'connection_1', 'repo_2',
            1, NOW()
          );
        `),
      ).rejects.toThrow(
        /ProviderApiKeyRepositoryLink_connection_workspace_fkey/,
      );

      await database.exec(`
        UPDATE "ProviderApiKeyConnection"
        SET "keyVersion" = 2, "latestOperationId" = 'operation_2', "updatedAt" = NOW()
        WHERE "id" = 'connection_1';
        UPDATE "ProviderApiKeyRepositoryLink"
        SET "status" = 'pending', "operationId" = 'operation_2',
            "attemptedKeyVersion" = 2, "attemptCount" = 2, "updatedAt" = NOW()
        WHERE "id" = 'link_1';
      `);
      const stale = await database.query<{
        readonly effective_status: string;
        readonly applied_key_version: number;
      }>(`
        SELECT
          CASE
            WHEN link."appliedKeyVersion" <> connection."keyVersion" THEN 'stale'
            ELSE link."status"
          END AS effective_status,
          link."appliedKeyVersion" AS applied_key_version
        FROM "ProviderApiKeyRepositoryLink" link
        JOIN "ProviderApiKeyConnection" connection
          ON connection."id" = link."providerApiKeyConnectionId"
        WHERE link."id" = 'link_1'
      `);
      expect(stale.rows).toEqual([
        {
          effective_status: "stale",
          applied_key_version: 1,
        },
      ]);

      const lateWrite = await database.query<QueryResult>(`
        UPDATE "ProviderApiKeyRepositoryLink"
        SET "status" = 'applied', "appliedKeyVersion" = 1, "updatedAt" = NOW()
        WHERE "id" = 'link_1'
          AND "operationId" = 'operation_1'
          AND EXISTS (
            SELECT 1
            FROM "ProviderApiKeyConnection"
            WHERE "id" = 'connection_1'
              AND "latestOperationId" = 'operation_1'
          )
      `);
      expect(lateWrite.affectedRows).toBe(0);

      const currentWrite = await database.query<QueryResult>(`
        UPDATE "ProviderApiKeyRepositoryLink"
        SET "status" = 'applied', "appliedKeyVersion" = 2, "updatedAt" = NOW()
        WHERE "id" = 'link_1'
          AND "operationId" = 'operation_2'
          AND EXISTS (
            SELECT 1
            FROM "ProviderApiKeyConnection"
            WHERE "id" = 'connection_1'
              AND "latestOperationId" = 'operation_2'
              AND "keyVersion" = 2
          )
      `);
      expect(currentWrite.affectedRows).toBe(1);

      const finalState = await database.query<{
        readonly key_version: number;
        readonly applied_key_version: number;
        readonly reconciliation_needed: boolean;
      }>(`
        SELECT
          connection."keyVersion" AS key_version,
          link."appliedKeyVersion" AS applied_key_version,
          link."reconciliationNeeded" AS reconciliation_needed
        FROM "ProviderApiKeyRepositoryLink" link
        JOIN "ProviderApiKeyConnection" connection
          ON connection."id" = link."providerApiKeyConnectionId"
        WHERE link."id" = 'link_1'
      `);
      expect(finalState.rows).toEqual([
        {
          key_version: 2,
          applied_key_version: 2,
          reconciliation_needed: false,
        },
      ]);
    } finally {
      await database.close();
    }
  });

  it("keeps prior applied versions and reconciliation state durable through Prisma", async () => {
    const database = new PGlite();
    let prisma: PrismaClient | undefined;
    let socketServer:
      | {
          start(): Promise<void>;
          stop(): Promise<void>;
          getServerConn(): string;
        }
      | undefined;
    try {
      await database.exec(`
        CREATE ROLE app LOGIN PASSWORD 'disposable-app-password';
      `);
      await applyProviderKeyFixtureMigrations(database);
      await database.exec(`
        INSERT INTO "Workspace" ("id", "slug", "name", "updatedAt") VALUES
          ('workspace_adapter', 'workspace-adapter', 'Workspace Adapter', NOW()),
          ('workspace_other', 'workspace-other', 'Workspace Other', NOW());
        INSERT INTO "GitHubInstallation" (
          "id", "workspaceId", "githubInstallationId", "accountLogin", "accountType",
          "repositorySelection", "updatedAt"
        ) VALUES (
          'installation_adapter', 'workspace_adapter', 301, 'acme', 'Organization',
          'selected', NOW()
        );
        INSERT INTO "RepositoryConnection" (
          "id", "workspaceId", "externalRepositoryId", "installationId", "githubRepositoryId",
          "owner", "name", "fullName", "defaultBranch", "visibility", "archived", "updatedAt"
        ) VALUES (
          'repo_adapter', 'workspace_adapter', 'external_adapter', 'installation_adapter', 302,
          'acme', 'one', 'acme/one', 'main', 'public', false, NOW()
        ),
        (
          'repo_other', 'workspace_other', 'external_other', NULL, 402,
          'other', 'two', 'other/two', 'main', 'public', false, NOW()
        );
      `);

      const platformRequire = createRequire(
        resolve(process.cwd(), "packages/platform/db/src/index.ts"),
      );
      const socketModulePath = platformRequire.resolve(
        "@electric-sql/pglite-socket",
        {
          paths: [resolve(process.cwd(), "packages/platform/db")],
        },
      );
      const { PGLiteSocketServer } = platformRequire(socketModulePath) as {
        PGLiteSocketServer: new (options: {
          readonly db: PGlite;
          readonly port: number;
          readonly host: string;
          readonly maxConnections: number;
        }) => {
          start(): Promise<void>;
          stop(): Promise<void>;
          getServerConn(): string;
        };
      };
      socketServer = new PGLiteSocketServer({
        db: database,
        port: 0,
        host: "127.0.0.1",
        maxConnections: 10,
      });
      await socketServer.start();
      const [host, port] = socketServer.getServerConn().split(":");
      prisma = createPrismaClient({
        databaseUrl: `postgres://app:disposable-app-password@${host}:${port}/postgres`,
        poolMax: 4,
      });

      const store = new PrismaProviderApiKeyStore(prisma);
      const repositories = new PrismaProviderApiKeyRepository(prisma);
      const workspaceGrants = new PrismaProviderApiKeyWorkspaceGrantStore(
        prisma,
      );
      expect(await workspaceGrants.isGranted("workspace_adapter")).toBe(false);
      await workspaceGrants.grant({
        workspaceId: "workspace_adapter",
        grantedBy: "operator:test",
        grantReason: "disposable integration test",
      });
      expect(await workspaceGrants.isGranted("workspace_adapter")).toBe(true);
      await workspaceGrants.revoke("workspace_adapter");
      expect(await workspaceGrants.isGranted("workspace_adapter")).toBe(false);
      expect(
        await repositories.findRepositoryTargets({
          workspaceId: "workspace_adapter",
          repositoryIds: ["repo_adapter", "repo_other"],
        }),
      ).toEqual([
        {
          repositoryId: "repo_adapter",
          repositoryFullName: "acme/one",
          githubInstallationId: "301",
          githubRepositoryId: "302",
          owner: "acme",
          repo: "one",
        },
      ]);

      await expect(
        store.prepareApply({
          workspaceId: "workspace_adapter",
          providerType: "mimo",
          encryptedApiKey: "must-not-be-persisted",
          repositoryIds: ["repo_other"],
        }),
      ).rejects.toThrow("repository_not_allowed");
      expect(
        await prisma.providerApiKeyConnection.count({
          where: {
            workspaceId: "workspace_adapter",
            providerType: "mimo",
          },
        }),
      ).toBe(0);

      const firstApply = await store.prepareApply({
        workspaceId: "workspace_adapter",
        providerType: "mimo",
        encryptedApiKey: "storage-cipher-v1",
        repositoryIds: ["repo_adapter"],
      });
      expect(
        await store.markRepositoryApplying({
          operationId: firstApply.operationId,
          repositoryId: "repo_adapter",
        }),
      ).toBe(true);
      expect(
        await store.recordRepositoryResult({
          operationId: firstApply.operationId,
          keyVersion: firstApply.keyVersion,
          result: {
            repositoryId: "repo_adapter",
            repositoryFullName: "acme/one",
            status: "applied",
            keyVersion: firstApply.keyVersion,
          },
        }),
      ).toBe("recorded");
      const connectionId = (
        await prisma.providerApiKeyConnection.findUniqueOrThrow({
          where: {
            workspaceId_providerType: {
              workspaceId: "workspace_adapter",
              providerType: "mimo",
            },
          },
          select: { id: true },
        })
      ).id;

      const rotation = await store.prepareApply({
        workspaceId: "workspace_adapter",
        providerType: "mimo",
        encryptedApiKey: "storage-cipher-v2",
        repositoryIds: ["repo_adapter"],
      });
      expect(rotation.keyVersion).toBe(2);
      expect(
        await store.markRepositoryApplying({
          operationId: rotation.operationId,
          repositoryId: "repo_adapter",
        }),
      ).toBe(true);
      expect(
        await store.recordRepositoryResult({
          operationId: rotation.operationId,
          keyVersion: rotation.keyVersion,
          result: {
            repositoryId: "repo_adapter",
            repositoryFullName: "acme/one",
            status: "failed",
            errorReason: "github_request_failed",
            keyVersion: rotation.keyVersion,
          },
        }),
      ).toBe("recorded");

      const failedRotationLink =
        await prisma.providerApiKeyRepositoryLink.findUniqueOrThrow({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connectionId,
              repositoryId: "repo_adapter",
            },
          },
        });
      expect(failedRotationLink.status).toBe("failed");
      expect(failedRotationLink.appliedKeyVersion).toBe(1);
      expect(failedRotationLink.attemptedKeyVersion).toBe(2);
      expect(failedRotationLink.reconciliationNeeded).toBe(false);
      expect(failedRotationLink.lastErrorReason).toBe("github_request_failed");
      expect(
        (
          await store.findState({
            workspaceId: "workspace_adapter",
            providerType: "mimo",
          })
        ).repositories[0],
      ).toMatchObject({
        status: "stale",
        appliedKeyVersion: 1,
        attemptedKeyVersion: 2,
        errorReason: "github_request_failed",
      });

      const reconciliationApply = await store.prepareApply({
        workspaceId: "workspace_adapter",
        providerType: "mimo",
        repositoryIds: ["repo_adapter"],
      });
      expect(
        await store.markRepositoryApplying({
          operationId: reconciliationApply.operationId,
          repositoryId: "repo_adapter",
        }),
      ).toBe(true);
      expect(
        await prisma.providerApiKeyRepositoryLink.findUniqueOrThrow({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connectionId,
              repositoryId: "repo_adapter",
            },
          },
          select: { status: true, reconciliationNeeded: true },
        }),
      ).toEqual({ status: "applying", reconciliationNeeded: true });
      expect(
        (
          await store.findState({
            workspaceId: "workspace_adapter",
            providerType: "mimo",
          })
        ).repositories[0]?.status,
      ).toBe("reconciliation_needed");

      expect(
        await store.recordRepositoryResult({
          operationId: reconciliationApply.operationId,
          keyVersion: reconciliationApply.keyVersion,
          result: {
            repositoryId: "repo_adapter",
            repositoryFullName: "acme/one",
            status: "reconciliation_needed",
            errorReason: "persistence_failed",
            keyVersion: reconciliationApply.keyVersion,
          },
        }),
      ).toBe("recorded");
      expect(
        await prisma.providerApiKeyRepositoryLink.findUniqueOrThrow({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connectionId,
              repositoryId: "repo_adapter",
            },
          },
          select: { status: true, reconciliationNeeded: true },
        }),
      ).toEqual({
        status: "reconciliation_needed",
        reconciliationNeeded: true,
      });

      await store.markRepositoryReconciliationNeeded({
        operationId: reconciliationApply.operationId,
        repositoryId: "repo_adapter",
        errorReason: "persistence_failed",
      });
      expect(
        await prisma.providerApiKeyRepositoryLink.findUniqueOrThrow({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connectionId,
              repositoryId: "repo_adapter",
            },
          },
          select: { status: true, reconciliationNeeded: true },
        }),
      ).toEqual({
        status: "reconciliation_needed",
        reconciliationNeeded: true,
      });

      const retry = await store.prepareApply({
        workspaceId: "workspace_adapter",
        providerType: "mimo",
        repositoryIds: ["repo_adapter"],
      });
      expect(
        await store.recordRepositoryResult({
          operationId: reconciliationApply.operationId,
          keyVersion: reconciliationApply.keyVersion,
          result: {
            repositoryId: "repo_adapter",
            repositoryFullName: "acme/one",
            status: "applied",
            keyVersion: reconciliationApply.keyVersion,
          },
        }),
      ).toBe("superseded");
      expect(
        await prisma.providerApiKeyRepositoryLink.findUniqueOrThrow({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connectionId,
              repositoryId: "repo_adapter",
            },
          },
          select: {
            status: true,
            operationId: true,
            reconciliationNeeded: true,
            lastErrorReason: true,
          },
        }),
      ).toEqual({
        status: "reconciliation_needed",
        operationId: retry.operationId,
        reconciliationNeeded: true,
        lastErrorReason: "persistence_failed",
      });
    } finally {
      await prisma?.$disconnect();
      await socketServer?.stop();
      await database.close();
    }
  });
});
