import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { linkExternalIdentity } from "../application/use-cases/link-external-identity";
import type { ExternalIdentity } from "../domain/external-identity";
import { PrismaUserRepository } from "../infrastructure/prisma/prisma-user-repository";
import { PrismaWorkspaceMembershipRepository } from "../infrastructure/prisma/prisma-workspace-membership-repository";
import { PrismaInstallationWorkspaceOwnerGrant } from "../../../github-installations/src/infrastructure/prisma/prisma-installation-workspace-owner-grant";

const adminUrl = process.env.AUTH_TEST_POSTGRES_ADMIN_URL;

// Actual Prisma/PostgreSQL adapter evidence on a disposable, minimal auth schema.
// This does not qualify historical migrations or unrelated application tables.
describe.skipIf(!adminUrl)("atomic external identity on PostgreSQL", () => {
  const name = `TEST_auth_${randomUUID().replaceAll("-", "")}`;
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let users: PrismaUserRepository;
  let created = false;

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("disposable_loopback_database_required");
    admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: adminUrl! }),
    });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), max: 12 }),
      transactionOptions: { maxWait: 10_000, timeout: 10_000 },
    });
    for (const statement of schema) await prisma.$executeRawUnsafe(statement);
    users = new PrismaUserRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "WorkspaceMember", "GitHubInstallation", "Workspace", "UserExternalIdentity", "User" CASCADE`,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
    await admin?.$disconnect();
  });

  function identity(
    provider: "github" | "gitlab",
    overrides: Partial<ExternalIdentity> = {},
  ): ExternalIdentity {
    return {
      provider,
      externalUserId: "123",
      login: "original",
      primaryEmail: "original@example.test",
      avatarUrl: null,
      ...overrides,
    };
  }

  it.each(["github", "gitlab"] as const)(
    "concurrent first %s logins converge to one identity owner and personal workspace",
    async (provider) => {
      const memberships = new PrismaWorkspaceMembershipRepository(prisma);
      const principals = await Promise.all(
        Array.from({ length: 8 }, () =>
          linkExternalIdentity(identity(provider), { users, memberships }),
        ),
      );
      const ownerIds = new Set(principals.map((principal) => principal.userId));
      expect(ownerIds.size).toBe(1);
      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.userExternalIdentity.count()).toBe(1);
      expect(await prisma.workspace.count()).toBe(1);
      expect(await prisma.workspaceMember.count()).toBe(1);
      const persisted = await prisma.userExternalIdentity.findUniqueOrThrow({
        where: {
          provider_externalUserId: { provider, externalUserId: "123" },
        },
      });
      expect(ownerIds).toEqual(new Set([persisted.userId]));
      const workspace = await prisma.workspace.findFirstOrThrow();
      expect(workspace.personalOwnerUserId).toBe(persisted.userId);
    },
  );

  it("reuses an installation owner's immutable User on the first GitHub login", async () => {
    const workspace = await prisma.workspace.create({
      data: { slug: "installed-org", name: "Installed organization" },
    });
    await prisma.gitHubInstallation.create({
      data: {
        workspaceId: workspace.id,
        githubInstallationId: 456n,
        accountLogin: "original",
        accountType: "User",
        repositorySelection: "all",
        status: "active",
      },
    });
    await new PrismaInstallationWorkspaceOwnerGrant(
      prisma,
    ).grantInstallationActorOwner({
      githubInstallationId: "456",
      githubUserId: "123",
      githubLogin: "original",
    });
    const installedUser = await prisma.user.findUniqueOrThrow({
      where: { githubUserId: 123n },
    });
    expect(await prisma.userExternalIdentity.count()).toBe(0);
    const principal = await linkExternalIdentity(identity("github"), {
      users,
      memberships: new PrismaWorkspaceMembershipRepository(prisma),
    });
    expect(principal.userId).toBe(installedUser.id);
    expect(await prisma.user.count()).toBe(1);
    expect(
      await prisma.workspaceMember.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: installedUser.id,
          },
        },
      }),
    ).toMatchObject({ role: "owner" });
    expect(
      await prisma.workspace.count({
        where: { personalOwnerUserId: installedUser.id },
      }),
    ).toBe(1);
  });

  it("canonicalizes numeric GitHub aliases to one persisted identity", async () => {
    const principals = await Promise.all(
      ["00123", "123", "000123"].map((externalUserId) =>
        users.upsertExternalIdentity(identity("github", { externalUserId })),
      ),
    );
    expect(new Set(principals.map((principal) => principal.userId)).size).toBe(
      1,
    );
    expect(principals.map((principal) => principal.externalUserId)).toEqual([
      "123",
      "123",
      "123",
    ]);
    expect(await prisma.userExternalIdentity.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it("converges with a simultaneous installation-owner writer using the same GitHub ID", async () => {
    const workspace = await prisma.workspace.create({
      data: { slug: "concurrent-org", name: "Concurrent organization" },
    });
    await prisma.gitHubInstallation.create({
      data: {
        workspaceId: workspace.id,
        githubInstallationId: 456n,
        accountLogin: "original",
        accountType: "User",
        repositorySelection: "all",
        status: "active",
      },
    });
    const [, principal] = await Promise.all([
      new PrismaInstallationWorkspaceOwnerGrant(
        prisma,
      ).grantInstallationActorOwner({
        githubInstallationId: "456",
        githubUserId: "123",
        githubLogin: "original",
      }),
      linkExternalIdentity(identity("github"), {
        users,
        memberships: new PrismaWorkspaceMembershipRepository(prisma),
      }),
    ]);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.userExternalIdentity.findFirstOrThrow()).toMatchObject({
      userId: principal.userId,
    });
    expect(
      await prisma.workspaceMember.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: principal.userId,
          },
        },
      }),
    ).toMatchObject({ role: "owner" });
  });

  it("keeps different immutable IDs and providers separate despite matching login/email", async () => {
    const principals = await Promise.all([
      users.upsertExternalIdentity(identity("github")),
      users.upsertExternalIdentity(identity("gitlab")),
      users.upsertExternalIdentity(
        identity("gitlab", { externalUserId: "456" }),
      ),
    ]);
    expect(new Set(principals.map((principal) => principal.userId)).size).toBe(
      3,
    );
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.userExternalIdentity.count()).toBe(3);
  });

  it.each(["github", "gitlab"] as const)(
    "rolls back new %s User creation when identity persistence fails, allowing a clean retry",
    async (provider) => {
      await expect(
        users.upsertExternalIdentity(
          identity(provider, { login: "__fail_identity_write__" }),
        ),
      ).rejects.toThrow();
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.userExternalIdentity.count()).toBe(0);
      const principal = await users.upsertExternalIdentity(identity(provider));
      expect(await prisma.user.count()).toBe(1);
      expect(
        await prisma.userExternalIdentity.findFirstOrThrow(),
      ).toMatchObject({
        userId: principal.userId,
      });
    },
  );

  it.each(["github", "gitlab"] as const)(
    "rolls back a %s profile update with its failed identity snapshot, then preserves owner on retry",
    async (provider) => {
      const original = await users.upsertExternalIdentity(identity(provider));
      await expect(
        users.upsertExternalIdentity(
          identity(provider, {
            login: "__fail_identity_write__",
            primaryEmail: "changed@example.test",
          }),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: original.userId } }),
      ).toMatchObject({
        primaryEmail: "original@example.test",
        githubLogin: provider === "github" ? "original" : null,
      });
      expect(
        await prisma.userExternalIdentity.findFirstOrThrow(),
      ).toMatchObject({
        userId: original.userId,
        login: "original",
        primaryEmail: "original@example.test",
      });
      const renamed = await users.upsertExternalIdentity(
        identity(provider, {
          login: "renamed",
          primaryEmail: "changed@example.test",
        }),
      );
      expect(renamed.userId).toBe(original.userId);
      expect(await prisma.user.count()).toBe(1);
      expect(
        await prisma.userExternalIdentity.findFirstOrThrow(),
      ).toMatchObject({
        userId: original.userId,
        login: "renamed",
        primaryEmail: "changed@example.test",
      });
    },
  );

  it("refuses a conflicting persisted GitHub owner without changing either User", async () => {
    const unrelated = await prisma.user.create({
      data: { githubUserId: 999n, githubLogin: "unrelated" },
    });
    const exact = await prisma.user.create({
      data: { githubUserId: 123n, githubLogin: "exact" },
    });
    await prisma.userExternalIdentity.create({
      data: {
        provider: "github",
        externalUserId: "123",
        userId: unrelated.id,
        login: "unrelated",
      },
    });
    await expect(
      users.upsertExternalIdentity(identity("github")),
    ).rejects.toThrow("external_identity_owner_conflict");
    expect(await prisma.userExternalIdentity.findFirstOrThrow()).toMatchObject({
      userId: unrelated.id,
      login: "unrelated",
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: exact.id } }),
    ).toMatchObject({
      githubLogin: "exact",
    });
    expect(await prisma.user.count()).toBe(2);
  });

  it("refuses an existing noncanonical alias without moving ownership or committing profile changes", async () => {
    const owner = await prisma.user.create({
      data: { githubUserId: 123n, githubLogin: "original" },
    });
    await prisma.userExternalIdentity.create({
      data: {
        provider: "github",
        externalUserId: "00123",
        userId: owner.id,
        login: "original",
      },
    });
    await expect(
      users.upsertExternalIdentity(identity("github", { login: "renamed" })),
    ).rejects.toThrow();
    expect(await prisma.userExternalIdentity.findFirstOrThrow()).toMatchObject({
      externalUserId: "00123",
      userId: owner.id,
      login: "original",
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    ).toMatchObject({
      githubLogin: "original",
    });
  });
});

// Scalar columns and ownership constraints used by the real auth/membership/
// installation adapters. Unrelated models, migrations and production ACLs are
// deliberately outside this fixture's evidence.
const schema = [
  `CREATE TYPE "ScmProvider" AS ENUM ('github', 'gitlab')`,
  `CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'member')`,
  `CREATE TYPE "WorkspaceDeletionState" AS ENUM ('active', 'delete_pending', 'deleted')`,
  `CREATE TYPE "GitHubInstallationStatus" AS ENUM ('pending', 'active', 'suspended', 'removed', 'permission_error', 'sync_error')`,
  `CREATE TABLE "User" (
    "id" text PRIMARY KEY, "githubUserId" bigint UNIQUE, "githubLogin" text,
    "primaryEmail" text, "avatarUrl" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
  )`,
  `CREATE TABLE "UserExternalIdentity" (
    "id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "provider" "ScmProvider" NOT NULL, "externalUserId" text NOT NULL, "login" text NOT NULL,
    "primaryEmail" text, "avatarUrl" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
    UNIQUE ("provider", "externalUserId"), UNIQUE ("userId", "provider")
  )`,
  `CREATE TABLE "Workspace" (
    "id" text PRIMARY KEY, "slug" text NOT NULL UNIQUE, "name" text NOT NULL,
    "reviewDraftPullRequests" boolean NOT NULL DEFAULT true,
    "providerManagementAdminOnly" boolean NOT NULL DEFAULT false,
    "deletionState" "WorkspaceDeletionState" NOT NULL DEFAULT 'active', "deletionRevision" integer NOT NULL DEFAULT 1,
    "deletionTombstonedAt" timestamp(3),
    "personalOwnerUserId" text UNIQUE REFERENCES "User"("id") ON DELETE RESTRICT,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
  )`,
  `CREATE TABLE "WorkspaceMember" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
    "userId" text REFERENCES "User"("id") ON DELETE SET NULL, "githubLogin" text,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
    UNIQUE ("workspaceId", "userId"), UNIQUE ("workspaceId", "githubLogin")
  )`,
  `CREATE TABLE "GitHubInstallation" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
    "githubInstallationId" bigint NOT NULL UNIQUE, "accountLogin" text NOT NULL,
    "accountType" text NOT NULL, "accountAvatarUrl" text, "repositorySelection" text NOT NULL,
    "status" "GitHubInstallationStatus" NOT NULL DEFAULT 'active',
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL
  )`,
  `CREATE FUNCTION fail_identity_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."login" = '__fail_identity_write__' THEN
        RAISE EXCEPTION 'injected_identity_write_failure';
      END IF;
      RETURN NEW;
    END
  $$`,
  `CREATE TRIGGER fail_identity_write BEFORE INSERT OR UPDATE ON "UserExternalIdentity"
    FOR EACH ROW EXECUTE FUNCTION fail_identity_write()`,
  `CREATE FUNCTION delay_first_user() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.025);
      RETURN NEW;
    END
  $$`,
  `CREATE TRIGGER delay_first_user BEFORE INSERT ON "User"
    FOR EACH ROW EXECUTE FUNCTION delay_first_user()`,
];
