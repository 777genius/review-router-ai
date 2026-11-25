import { describe, expect, it, vi } from "vitest";
import { PrismaMemoryPermission } from "./prisma-memory-permission";

describe("PrismaMemoryPermission", () => {
  const githubActor = {
    kind: "github_user" as const,
    id: "github:12",
    githubUserId: "12",
    login: "maintainer",
  };

  it("rejects login-only identity and local-admin login bypass in production", async () => {
    const prisma = { workspaceMember: { findFirst: vi.fn() } };
    const permissions = new PrismaMemoryPermission(prisma as never, {
      localAdminGithubLogins: ["maintainer"],
    });
    await expect(
      permissions.canConfirmMemory({
        workspaceId: "workspace",
        repositoryId: null,
        userId: null,
        scope: "workspace",
        actor: { ...githubActor, githubUserId: null },
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "not_workspace_admin" });
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
  });

  it("uses stable numeric GitHub identity and an authoritative maintainer resolver", async () => {
    const prisma = {
      repositoryConnection: {
        findFirst: vi.fn(async () => ({ selected: true, archived: false })),
      },
      workspaceMember: { findFirst: vi.fn(async () => ({ role: "member" })) },
    };
    const isMaintainer = vi.fn(async () => "maintainer" as const);
    const permissions = new PrismaMemoryPermission(prisma as never, {
      repositoryMaintainers: { isMaintainer },
    });
    await expect(
      permissions.canConfirmMemory({
        workspaceId: "workspace",
        repositoryId: "repository",
        userId: null,
        scope: "repository",
        actor: githubActor,
      }),
    ).resolves.toEqual({ allowed: true });
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace",
        OR: [{ user: { githubUserId: 12n } }],
      },
      select: { role: true },
    });
    expect(isMaintainer).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repositoryId: "repository",
      actor: githubActor,
    });
  });

  it("does not treat ordinary repository write permission as maintainer authority", async () => {
    const prisma = {
      repositoryConnection: {
        findFirst: vi.fn(async () => ({ selected: true, archived: false })),
      },
      workspaceMember: { findFirst: vi.fn(async () => ({ role: "member" })) },
    };
    const permissions = new PrismaMemoryPermission(prisma as never, {
      repositoryMaintainers: { isMaintainer: async () => "not_maintainer" },
    });
    await expect(
      permissions.canConfirmMemory({
        workspaceId: "workspace",
        repositoryId: "repository",
        userId: null,
        scope: "repository",
        actor: githubActor,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "not_repository_maintainer",
    });
  });

  it("maps a stable GitHub user to their product user before preference ownership", async () => {
    const prisma = {
      user: { findFirst: vi.fn(async () => ({ id: "product_user" })) },
    };
    const permissions = new PrismaMemoryPermission(prisma as never);
    await expect(
      permissions.canConfirmMemory({
        workspaceId: "workspace",
        repositoryId: null,
        userId: "product_user",
        scope: "user_prefs",
        actor: githubActor,
      }),
    ).resolves.toEqual({ allowed: true });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { githubUserId: 12n },
      select: { id: true },
    });
  });
  it("authorizes workspace_user actors through WorkspaceMember.userId", async () => {
    const prisma = {
      workspaceMember: {
        findFirst: vi.fn().mockResolvedValue({ role: "admin" }),
      },
    };
    const permission = new PrismaMemoryPermission(prisma as never);

    await expect(
      permission.canConfirmMemory({
        workspaceId: "workspace_1",
        repositoryId: null,
        userId: null,
        scope: "workspace",
        actor: {
          kind: "workspace_user",
          id: "user_gitlab",
          githubUserId: null,
          login: "gitlab-maintainer",
        },
      }),
    ).resolves.toEqual({ allowed: true });

    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        OR: [{ userId: "user_gitlab" }],
      },
      select: { role: true },
    });
  });

  it("does not treat workspace_user login as a GitHub local admin override", async () => {
    const prisma = {
      workspaceMember: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const permission = new PrismaMemoryPermission(prisma as never, {
      localAdminGithubLogins: ["gitlab-maintainer"],
    });

    await expect(
      permission.canConfirmMemory({
        workspaceId: "workspace_1",
        repositoryId: null,
        userId: null,
        scope: "workspace",
        actor: {
          kind: "workspace_user",
          id: "user_gitlab",
          githubUserId: null,
          login: "gitlab-maintainer",
        },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "not_workspace_admin",
      retryable: false,
    });
  });
});
