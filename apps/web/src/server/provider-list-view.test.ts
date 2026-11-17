import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardMutationActor } from "./dashboard-mutations";
import { loadProviderListView } from "./provider-list-view";

type Workspace = Readonly<{
  id: string;
  deletionState: "active" | "deleting" | "deleted";
}>;

/**
 * Only the reads of an empty provider list plus the real authority read:
 * the workspace lookup honors its `where` and members are by workspace/user.
 */
function stubPrisma(input: {
  workspaces: readonly Workspace[];
  members: readonly Readonly<{
    workspaceId: string;
    userId: string;
    role: "owner" | "admin" | "member";
  }>[];
}): PrismaClient {
  const prisma = {
    workspace: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; deletionState?: string };
      }) => {
        const workspace = input.workspaces.find(
          (row) =>
            row.id === where.id &&
            (where.deletionState === undefined ||
              row.deletionState === where.deletionState),
        );
        return workspace
          ? { personalOwnerUserId: null, providerManagementAdminOnly: false }
          : null;
      },
    },
    workspaceMember: {
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_userId: { workspaceId: string; userId: string } };
      }) => {
        const { workspaceId, userId } = where.workspaceId_userId;
        const member = input.members.find(
          (row) => row.workspaceId === workspaceId && row.userId === userId,
        );
        return member ? { role: member.role } : null;
      },
      findMany: async () => [],
    },
    workspaceProviderProfile: { findMany: async () => [] },
    reviewConfiguration: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return prisma as unknown as PrismaClient;
}

const actor = (
  userId: string,
  githubLogin = `${userId}-login`,
): DashboardMutationActor => ({
  userId,
  sourceProvider: "github",
  externalUserId: `gh-${userId}`,
  sourceLogin: githubLogin,
  githubUserId: `gh-${userId}`,
  githubLogin,
  actor: `github:${githubLogin}`,
});

const prisma = stubPrisma({
  workspaces: [
    { id: "workspace_1", deletionState: "active" },
    { id: "workspace_deleted", deletionState: "deleted" },
  ],
  members: [
    { workspaceId: "workspace_1", userId: "user_member", role: "member" },
    { workspaceId: "workspace_deleted", userId: "user_member", role: "owner" },
  ],
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadProviderListView authorization", () => {
  it("reads the list for a member of an active workspace", async () => {
    vi.stubEnv("REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS", "");
    const view = await loadProviderListView({
      prisma,
      workspaceId: "workspace_1",
      actor: actor("user_member"),
    });
    expect(view).toMatchObject({
      workspaceId: "workspace_1",
      viewerIsAdmin: false,
      rows: [],
    });
    expect(view?.readAt).toBeGreaterThan(0);
  });

  it("refuses a signed-in user who is not a member", async () => {
    vi.stubEnv("REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS", "");
    await expect(
      loadProviderListView({
        prisma,
        workspaceId: "workspace_1",
        actor: actor("user_outsider"),
      }),
    ).resolves.toBeNull();
  });

  it("refuses a deleted workspace even to its former owner", async () => {
    vi.stubEnv("REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS", "");
    await expect(
      loadProviderListView({
        prisma,
        workspaceId: "workspace_deleted",
        actor: actor("user_member"),
      }),
    ).resolves.toBeNull();
  });

  it("lets a configured local admin read it as an admin without membership", async () => {
    vi.stubEnv("REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS", "ops-admin");
    const view = await loadProviderListView({
      prisma,
      workspaceId: "workspace_1",
      actor: actor("user_operator", "ops-admin"),
    });
    expect(view).toMatchObject({
      workspaceId: "workspace_1",
      viewerIsAdmin: true,
    });
  });
});
