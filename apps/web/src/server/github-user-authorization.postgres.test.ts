import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getValidGitHubUserAccessToken,
  revokeGitHubUserAuthorization,
  saveGitHubUserAuthorizationFromAccount,
} from "./github-user-authorization";
import {
  listGitHubUserRepositoryAccess,
  refreshGitHubUserRepositoryAccess,
  updateRepositoryPermissionCacheFromLiveCheck,
} from "./github-user-repository-access";
import { clearEmptyRepositoryAccessCacheForUser } from "./github-repository-permission-cache";

const adminUrl = process.env.AUTH_TEST_POSTGRES_ADMIN_URL;
if (process.env.GITHUB_AUTH_REQUIRE_POSTGRES === "1" && !adminUrl) {
  throw new Error("github_auth_disposable_postgres_required");
}
const env = {
  GITHUB_APP_CLIENT_ID: "test-client",
  GITHUB_APP_CLIENT_SECRET: "test-secret",
  GITHUB_APP_SLUG: "reviewrouter-test",
  REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY:
    "test-token-encryption-secret-0123456789abcdef",
};
const actor = {
  userId: "user_1",
  githubUserId: "123",
  githubLogin: "maintainer",
};
const principal = {
  provider: "github",
  ...actor,
  externalUserId: "123",
  login: "maintainer",
  primaryEmail: null,
  avatarUrl: null,
} as const;

describe.skipIf(!adminUrl)(
  "GitHub authorization PostgreSQL and HTTP acceptance",
  () => {
    const databaseName = `TEST_github_auth_${randomUUID().replaceAll("-", "")}`;
    let admin: pg.Client;
    let dbUrl: string;
    let prisma: PrismaClient;
    let origin: string;
    let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    const server = createServer((req, res) => {
      void handler(req, res).catch(() => res.destroy());
    });
    const transport: typeof fetch = (url, init) => {
      const target = new URL(
        typeof url === "string" || url instanceof URL ? url : url.url,
      );
      return fetch(new URL(target.pathname + target.search, origin), init);
    };
    const input = () => ({ prisma, actor, env, fetch: transport });
    const tokenInput = () => ({
      prisma,
      userId: actor.userId,
      env,
      fetch: transport,
    });
    let calls = 0;
    const send = (res: ServerResponse, body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const respond = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/login/oauth/access_token")
        return send(res, {
          access_token: "ghu_rotated",
          refresh_token: "ghr_rotated",
          expires_in: 3600,
          refresh_token_expires_in: 86400,
        });
      if (req.url?.startsWith("/user/installations/101/repositories"))
        return send(res, {
          repositories: [{ id: 1001, permissions: { admin: true } }],
        });
      return send(res, { installations: [{ id: 101 }] });
    };
    const save = (
      account = {
        access_token: "ghu_current",
        refresh_token: "ghr_current",
        expires_in: 3600,
      },
    ) =>
      saveGitHubUserAuthorizationFromAccount({
        prisma,
        env,
        principal,
        account,
      });

    beforeAll(async () => {
      const url = new URL(adminUrl!);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
        throw new Error("disposable_loopback_database_required");
      admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      url.pathname = `/${databaseName}`;
      dbUrl = url.toString();
      const setup = new pg.Client({ connectionString: dbUrl });
      await setup.connect();
      try {
        // The two owning migrations run unchanged. Only unrelated referenced
        // tables are reduced to the columns used by this authorization journey.
        await setup.query(`
        CREATE TYPE "ScmProvider" AS ENUM ('github', 'gitlab');
        CREATE TYPE "GitHubInstallationStatus" AS ENUM ('pending','active','suspended','removed','permission_error','sync_error');
        CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "githubUserId" BIGINT);
        CREATE TABLE "GitHubInstallation" ("id" TEXT PRIMARY KEY, "githubInstallationId" BIGINT,
          "workspaceId" TEXT, "status" "GitHubInstallationStatus");
        CREATE TABLE "RepositoryConnection" ("id" TEXT PRIMARY KEY, "workspaceId" TEXT,
          "provider" "ScmProvider", "githubRepositoryId" BIGINT, "installationId" TEXT,
          "selected" BOOLEAN, "archived" BOOLEAN);
        INSERT INTO "User" VALUES ('user_1',123);
        INSERT INTO "GitHubInstallation" VALUES ('install_1',101,'workspace_1','active');
        INSERT INTO "RepositoryConnection" VALUES
          ('repo_1','workspace_1','github',1001,'install_1',true,false),
          ('repo_2','workspace_1','github',1002,'install_1',true,false);
      `);
        await setup.query(
          await readFile(
            new URL(
              "../../../../packages/platform/db/prisma/migrations/000012_github_user_repository_access/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await setup.query(`INSERT INTO "RepositoryPermissionCache"
        ("id","userId","repositoryId","githubInstallationId","canManage","checkedAt","expiresAt","updatedAt")
        VALUES ('old','user_1','repo_1',101,true,NOW(),NOW()+interval '1 hour',NOW())`);
        await setup.query(
          await readFile(
            new URL(
              "../../../../packages/platform/db/prisma/migrations/000161_github_authorization_revision/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        expect(
          (
            await setup.query(
              'SELECT COUNT(*)::int AS count FROM "RepositoryPermissionCache"',
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await setup.end();
      }
      prisma = createPrismaClient({
        databaseUrl: dbUrl,
        poolMax: 8,
        transactionTimeoutMs: 10_000,
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("http_fixture_address_missing");
      origin = `http://127.0.0.1:${address.port}`;
    });

    beforeEach(async () => {
      await prisma.repositoryPermissionCache.deleteMany();
      await prisma.gitHubUserAuthorization.deleteMany();
      clearEmptyRepositoryAccessCacheForUser(actor.userId);
      calls = 0;
      handler = async (req, res) => {
        calls++;
        respond(req, res);
      };
      await save();
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma?.$disconnect();
      if (admin) {
        await admin.query(
          `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
        );
        await admin.end();
      }
    });

    it("atomically admits one of two refreshes that read the same old row", async () => {
      await save({
        access_token: "ghu_old",
        refresh_token: "ghr_old",
        expires_in: 60,
      });
      const locked = new pg.Client({ connectionString: dbUrl });
      await locked.connect();
      const requested = deferred<void>(),
        release = deferred<void>();
      handler = async (req, res) => {
        calls++;
        requested.resolve();
        await release.promise;
        respond(req, res);
      };
      const attempts: ReturnType<typeof getValidGitHubUserAccessToken>[] = [];
      try {
        await locked.query("BEGIN");
        await locked.query(
          'SELECT "id" FROM "GitHubUserAuthorization" FOR UPDATE',
        );
        const first = getValidGitHubUserAccessToken(tokenInput());
        const second = getValidGitHubUserAccessToken(tokenInput());
        attempts.push(first, second);
        await vi.waitFor(
          async () => {
            await locked.query("SELECT pg_stat_clear_snapshot()");
            const waiting = await locked.query(
              `SELECT COUNT(*)::int AS count FROM pg_stat_activity
          WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%UPDATE%GitHubUserAuthorization%'`,
              [databaseName],
            );
            expect(waiting.rows[0].count).toBe(2);
          },
          { timeout: 5000, interval: 20 },
        );
        await locked.query("COMMIT");
        await requested.promise;
        await expect(Promise.race([first, second])).resolves.toMatchObject({
          status: "refresh_failed",
        });
        expect(calls).toBe(1);
        release.resolve();
        const results = await Promise.all([first, second]);
        expect(
          results.filter((result) => result.status === "ready"),
        ).toHaveLength(1);
        expect(
          (await prisma.gitHubUserAuthorization.findFirstOrThrow()).revokedAt,
        ).toBeNull();
      } finally {
        release.resolve();
        await locked.query("ROLLBACK");
        await locked.end();
        await Promise.allSettled(attempts);
      }
    });

    it("does not revive a revoked authorization when the real HTTP refresh finishes late", async () => {
      await save({
        access_token: "ghu_old",
        refresh_token: "ghr_old",
        expires_in: 60,
      });
      const requested = deferred<void>(),
        release = deferred<void>();
      handler = async (req, res) => {
        requested.resolve();
        await release.promise;
        respond(req, res);
      };
      const pending = getValidGitHubUserAccessToken(tokenInput());
      await requested.promise;
      await revokeGitHubUserAuthorization({ prisma, env, githubUserId: "123" });
      release.resolve();
      await expect(pending).resolves.toMatchObject({ status: "revoked" });
      expect(
        (await prisma.gitHubUserAuthorization.findFirstOrThrow()).revokedAt,
      ).not.toBeNull();
    });

    it("refuses late discovery publication after revocation and subsequent cached access", async () => {
      const requested = deferred<void>(),
        release = deferred<void>();
      handler = async (req, res) => {
        if (req.url?.startsWith("/user/installations/101/repositories")) {
          requested.resolve();
          await release.promise;
        }
        respond(req, res);
      };
      const pending = refreshGitHubUserRepositoryAccess(input());
      await requested.promise;
      await revokeGitHubUserAuthorization({ prisma, env, githubUserId: "123" });
      release.resolve();
      await expect(pending).resolves.toMatchObject({
        status: "token_refresh_failed",
      });
      expect(await prisma.repositoryPermissionCache.count()).toBe(0);
      await expect(
        listGitHubUserRepositoryAccess(input()),
      ).resolves.toMatchObject({ status: "token_revoked" });
    });

    it("a stale HTTP 401 cannot revoke the reauthorized generation", async () => {
      const requested = deferred<void>(),
        release = deferred<void>();
      handler = async (_req, res) => {
        requested.resolve();
        await release.promise;
        send(res, {}, 401);
      };
      const pending = refreshGitHubUserRepositoryAccess(input());
      await requested.promise;
      await save({
        access_token: "ghu_reauthorized",
        refresh_token: "ghr_reauthorized",
        expires_in: 3600,
      });
      release.resolve();
      await expect(pending).resolves.toMatchObject({
        status: "token_refresh_failed",
      });
      expect(
        (await prisma.gitHubUserAuthorization.findFirstOrThrow()).revokedAt,
      ).toBeNull();
      handler = async (req, res) => {
        respond(req, res);
      };
      expect([
        ...(await listGitHubUserRepositoryAccess(input())).repositoryIds,
      ]).toEqual(["repo_1"]);
    });

    it("fences live-check cache writes and does not trust an unversioned cache row", async () => {
      await prisma.repositoryPermissionCache.create({
        data: {
          userId: actor.userId,
          repositoryId: "repo_2",
          githubInstallationId: 101n,
          canManage: true,
          checkedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          permission: "admin",
        },
      });
      expect([
        ...(await listGitHubUserRepositoryAccess(input())).repositoryIds,
      ]).toEqual(["repo_1"]);
      const authority = await getValidGitHubUserAccessToken(tokenInput());
      if (authority.status !== "ready")
        throw new Error("fixture_authorization_required");
      await save();
      await expect(
        updateRepositoryPermissionCacheFromLiveCheck({
          prisma,
          actor,
          authority: authority.authority,
          repositoryId: "repo_2",
          githubInstallationId: 101n,
          permission: "admin",
          roleName: "admin",
          canManage: true,
        }),
      ).resolves.toBe(false);
      expect(
        await prisma.repositoryPermissionCache.count({
          where: {
            repositoryId: "repo_2",
            authorizationRevision: { not: null },
          },
        }),
      ).toBe(0);
    });

    it("scopes negative discovery by app/revision and preserves unrelated app cache", async () => {
      handler = async (_req, res) => {
        calls++;
        send(res, { installations: [] });
      };
      await listGitHubUserRepositoryAccess(input());
      expect(calls).toBe(1);
      const otherEnv = { ...env, GITHUB_APP_SLUG: "another-app" };
      await saveGitHubUserAuthorizationFromAccount({
        prisma,
        env: otherEnv,
        principal,
        account: { access_token: "ghu_other", expires_in: 3600 },
      });
      handler = async (req, res) => {
        calls++;
        respond(req, res);
      };
      expect([
        ...(await listGitHubUserRepositoryAccess({ ...input(), env: otherEnv }))
          .repositoryIds,
      ]).toEqual(["repo_1"]);
      expect(calls).toBe(3);
      await prisma.repositoryPermissionCache.updateMany({
        where: { repositoryId: "repo_1" },
        data: { repositoryId: "repo_2" },
      });
      await save();
      expect([
        ...(await listGitHubUserRepositoryAccess(input())).repositoryIds,
      ]).toEqual(["repo_1"]);
      expect(
        await prisma.repositoryPermissionCache.count({
          where: {
            repositoryId: "repo_2",
            authorizationAppSlug: "another-app",
          },
        }),
      ).toBe(1);
    });

    it("reads a valid cache using a SELECT-only read-only PostgreSQL role", async () => {
      await refreshGitHubUserRepositoryAccess(input());
      const role = `rr_auth_reader_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID();
      const setup = new pg.Client({ connectionString: dbUrl });
      await setup.connect();
      let reader: PrismaClient | undefined;
      try {
        await setup.query(
          `CREATE ROLE "${role}" LOGIN PASSWORD ${pg.escapeLiteral(password)}`,
        );
        await setup.query(
          `ALTER ROLE "${role}" SET default_transaction_read_only = on`,
        );
        await setup.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
        await setup.query(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`,
        );
        const readUrl = new URL(dbUrl);
        readUrl.username = role;
        readUrl.password = password;
        reader = createPrismaClient({
          databaseUrl: readUrl.toString(),
          poolMax: 2,
        });
        expect(
          await reader.$queryRaw`SHOW default_transaction_read_only`,
        ).toEqual([{ default_transaction_read_only: "on" }]);
        expect([
          ...(
            await listGitHubUserRepositoryAccess({ ...input(), prisma: reader })
          ).repositoryIds,
        ]).toEqual(["repo_1"]);
        await revokeGitHubUserAuthorization({
          prisma,
          env,
          githubUserId: "123",
        });
        await expect(
          listGitHubUserRepositoryAccess({ ...input(), prisma: reader }),
        ).resolves.toMatchObject({ status: "token_revoked" });
      } finally {
        await reader?.$disconnect();
        await setup.query(`DROP OWNED BY "${role}"`);
        await setup.query(`DROP ROLE "${role}"`);
        await setup.end();
      }
    });

    it("does not resend the one-use token after an actual socket response loss", async () => {
      await save({
        access_token: "ghu_old",
        refresh_token: "ghr_old",
        expires_in: 60,
      });
      handler = async (_req, res) => {
        calls++;
        res.destroy();
      };
      await expect(
        getValidGitHubUserAccessToken(tokenInput()),
      ).resolves.toMatchObject({ status: "refresh_failed" });
      await expect(
        getValidGitHubUserAccessToken(tokenInput()),
      ).resolves.toMatchObject({
        status: "refresh_failed",
        errorCode: "github_user_token_refresh_reauthorization_required",
      });
      expect(calls).toBe(1);
      expect(
        (await prisma.gitHubUserAuthorization.findFirstOrThrow())
          .refreshAttemptId,
      ).not.toBeNull();
    });
  },
);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
