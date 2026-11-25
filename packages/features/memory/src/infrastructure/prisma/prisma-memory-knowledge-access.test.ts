import { describe, expect, it, vi } from "vitest";
import { PrismaMemoryKnowledgeAccess } from "./prisma-memory-knowledge-access";
import { createMemoryPolicyConfig } from "../../application/ports/memory-policy-config-port";
import type { MemoryKnowledgeSource } from "../../domain/memory-knowledge";

const now = new Date("2026-10-23T10:00:00.000Z");
const controls = { deadlineAt: new Date(now.getTime() + 10000) };
const actor = {
  kind: "github_user" as const,
  id: "github:123",
  githubUserId: "123",
  login: "maintainer",
};
const scope = {
  kind: "repository" as const,
  workspaceId: "workspace",
  repositoryId: "repository",
};
const manual: MemoryKnowledgeSource = {
  type: "manual",
  sourceId: "manual:11111111-1111-4111-8111-111111111111",
  revision: now.toISOString(),
  updatedAt: now.toISOString(),
  statementAt: now.toISOString(),
  repositoryId: scope.repositoryId,
  pullRequestNumber: null,
  url: null,
  visibility: "internal",
  claimedBodyDigest: null,
  observedCommitSha: null,
};

function fixture(
  options: {
    role?: "owner" | "admin" | "member" | null;
    membersCanView?: boolean;
    maintainersCanManage?: boolean;
    permitted?: boolean;
    runtime?: boolean;
  } = {},
) {
  const prisma = {
    workspaceMember: {
      findFirst: vi.fn(async () =>
        options.role === null ? null : { role: options.role ?? "member" },
      ),
    },
    repositoryConnection: {
      findFirst: vi.fn(async () => ({ selected: true, archived: false })),
    },
    user: { findFirst: vi.fn(async () => ({ id: "product_user" })) },
  };
  const permissions = {
    canConfirmMemory: vi.fn(async () =>
      options.permitted === false
        ? {
            allowed: false as const,
            reason: "not_repository_maintainer" as const,
            retryable: false,
          }
        : { allowed: true as const },
    ),
  };
  const policy = {
    getPolicy: vi.fn(async () =>
      createMemoryPolicyConfig({
        authority: {
          membersCanView: options.membersCanView ?? true,
          repositoryMaintainerCanManage: options.maintainersCanManage ?? true,
        },
      }),
    ),
  };
  const dependencies = {
    prisma: prisma as never,
    permissions,
    policy,
    now: () => now,
    ...(options.runtime
      ? {
          runtimeGrant: {
            actorId: "execution_1",
            scopes: [scope],
            headSha: "a".repeat(40),
          },
        }
      : {}),
  };
  return {
    prisma,
    permissions,
    policy,
    dependencies,
    access: new PrismaMemoryKnowledgeAccess(dependencies),
  };
}

describe("PrismaMemoryKnowledgeAccess", () => {
  it("permits only the exact trusted system runtime grant and never grants it management/export", async () => {
    const { access } = fixture({ runtime: true });
    const system = {
      kind: "system" as const,
      id: "execution_1",
      githubUserId: null,
      login: null,
    };
    await expect(
      access.authorize({ actor: system, scope, action: "runtime" }, controls),
    ).resolves.toBeUndefined();
    for (const action of ["read", "manage", "export"] as const)
      await expect(
        access.authorize({ actor: system, scope, action }, controls),
      ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      access.authorize(
        { actor: { ...system, id: "execution_2" }, scope, action: "runtime" },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      access.authorize(
        {
          actor: system,
          scope: { ...scope, repositoryId: "other" },
          action: "runtime",
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("uses stable member identity for reads and honors member visibility while keeping admin access", async () => {
    const member = fixture({ permitted: false });
    await expect(
      member.access.authorize({ actor, scope, action: "read" }, controls),
    ).resolves.toBeUndefined();
    expect(member.prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: scope.workspaceId,
        OR: [{ user: { githubUserId: 123n } }],
      },
      select: { role: true },
    });
    const closed = fixture({ membersCanView: false, permitted: false });
    await expect(
      closed.access.authorize({ actor, scope, action: "read" }, controls),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      fixture({
        role: "owner",
        membersCanView: false,
        permitted: false,
      }).access.authorize({ actor, scope, action: "export" }, controls),
    ).resolves.toBeUndefined();
    await expect(
      member.access.authorize(
        { actor: { ...actor, githubUserId: null }, scope, action: "read" },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("honors repository maintainer management policy before consulting a permissive resolver", async () => {
    const { access, permissions } = fixture({
      role: null,
      maintainersCanManage: false,
    });
    await expect(
      access.authorize({ actor, scope, action: "manage" }, controls),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(permissions.canConfirmMemory).not.toHaveBeenCalled();
    await expect(
      fixture({ role: null, maintainersCanManage: true }).access.authorize(
        { actor, scope, action: "manage" },
        controls,
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps user preference access tied to the resolved product user, including for admins", async () => {
    const { access } = fixture({ role: "admin" });
    await expect(
      access.authorize(
        {
          actor,
          scope: {
            kind: "user_preference",
            workspaceId: scope.workspaceId,
            userId: "product_user",
          },
          action: "read",
        },
        controls,
      ),
    ).resolves.toBeUndefined();
    await expect(
      access.authorize(
        {
          actor,
          scope: {
            kind: "user_preference",
            workspaceId: scope.workspaceId,
            userId: "other",
          },
          action: "read",
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepts only server-shaped manual decisions and rejects unverified GitHub source claims", async () => {
    const { access } = fixture({ role: "admin" });
    await expect(
      access.verifySource({ actor, scope, source: manual }, controls),
    ).resolves.toEqual(manual);
    await expect(
      access.verifySource(
        {
          actor,
          scope,
          source: { ...manual, url: "https://private.example/source" },
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      access.verifySource(
        {
          actor,
          scope,
          source: { ...manual, sourceId: "raw_thread_disguised_as_id" },
        },
        controls,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      access.verifySource(
        { actor, scope, source: { ...manual, type: "github_comment" } },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requires exact source commit applicability while keeping intended rules authoritative", async () => {
    const { access } = fixture({ runtime: true });
    const system = {
      kind: "system" as const,
      id: "execution_1",
      githubUserId: null,
      login: null,
    };
    const input = { actor: system, scope, consumer: "runtime" as const };
    expect(
      await access.sourceApplicable({ ...input, source: manual }, controls),
    ).toBe(true);
    expect(
      await access.sourceApplicable(
        { ...input, source: { ...manual, observedCommitSha: "a".repeat(40) } },
        controls,
      ),
    ).toBe(true);
    expect(
      await access.sourceApplicable(
        { ...input, source: { ...manual, observedCommitSha: "b".repeat(40) } },
        controls,
      ),
    ).toBe(false);
  });

  it("checks linked repository ownership and requires private promotion links to be sanitized", async () => {
    const { dependencies, prisma } = fixture({ role: "admin" });
    const github = {
      ...manual,
      type: "github_comment" as const,
      sourceId: "github:123",
      visibility: "private" as const,
      url: "https://github.com/private/repo/comments/123",
    };
    const verifySource = vi.fn(
      async (): Promise<MemoryKnowledgeSource> => github,
    );
    const access = new PrismaMemoryKnowledgeAccess({
      ...dependencies,
      sourceAuthority: { verifySource },
    });
    const workspace = {
      kind: "workspace" as const,
      workspaceId: scope.workspaceId,
    };
    await expect(
      access.verifySource(
        { actor, scope: workspace, source: github },
        controls,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    verifySource.mockResolvedValueOnce({ ...github, url: null });
    await expect(
      access.verifySource(
        { actor, scope: workspace, source: github },
        controls,
      ),
    ).resolves.toMatchObject({ url: null });
    expect(prisma.repositoryConnection.findFirst).toHaveBeenCalledWith({
      where: { id: scope.repositoryId, workspaceId: scope.workspaceId },
      select: { selected: true, archived: true },
    });
    prisma.repositoryConnection.findFirst.mockResolvedValueOnce({
      selected: false,
      archived: false,
    });
    expect(
      await access.sourceApplicable(
        { actor, scope, source: github, consumer: "management" },
        controls,
      ),
    ).toBe(false);
  });
});
