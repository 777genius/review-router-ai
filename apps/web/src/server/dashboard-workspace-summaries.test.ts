import { describe, expect, it, vi } from "vitest";
import { createDashboardWorkspaceSummaryLoader } from "./dashboard-workspace-summaries";

const baseAccess = {
  status: "ready" as const,
  workspaceIds: [] as string[],
  repositoryIds: new Set<string>(),
  directConfigRepositoryIds: new Set<string>(),
  checkedAt: null,
};
const mainWorkspace = {
  id: "ws_1",
  name: "Example",
  slug: "example",
  installations: [
    {
      accountLogin: "acme",
      accountType: "Organization",
      accountAvatarUrl: null,
      githubInstallationId: 100n,
      status: "active",
      repositorySelection: "selected",
    },
    {
      accountLogin: "other",
      accountType: "Organization",
      accountAvatarUrl: null,
      githubInstallationId: 200n,
      status: "active",
      repositorySelection: "selected",
    },
  ],
  gitLabInstallations: [
    {
      id: "gitlab_1",
      sourceBaseUrl: "https://gitlab.com",
      namespacePath: "private",
      sourceKind: "gitlab",
      status: "active",
      selectedProjects: 1,
      lastInstalledAt: null,
    },
  ],
  repositories: [{ owner: "acme" }],
  _count: { repositories: 1 },
};
function harness(workspaces: readonly unknown[] = [mainWorkspace]) {
  const findMany = vi.fn().mockResolvedValue(workspaces);
  const load = createDashboardWorkspaceSummaryLoader({
    getPrisma: (() => ({ workspace: { findMany } })) as unknown as Parameters<
      typeof createDashboardWorkspaceSummaryLoader
    >[0]["getPrisma"],
  });
  return { findMany, load };
}

describe("dashboard workspace read model visibility", () => {
  it("skips DB queries when no workspace or repository has been authorized", async () => {
    const h = harness();
    expect(
      await h.load({ kind: "none", reason: "signed_out" }, baseAccess),
    ).toEqual([]);
    expect(
      await h.load({ kind: "workspace_ids", workspaceIds: [] }, baseAccess),
    ).toEqual([]);
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("restricts repository-only actors to visible repository IDs and owners", async () => {
    const h = harness();
    const result = await h.load(
      { kind: "none", reason: "signed_out" },
      {
        ...baseAccess,
        workspaceIds: ["ws_1"],
        repositoryIds: new Set(["repo_1"]),
      },
    );
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["ws_1"] } },
        select: expect.objectContaining({
          repositories: expect.objectContaining({
            where: {
              OR: [
                { workspaceId: { in: [] } },
                { id: { in: ["repo_1"] } },
              ],
            },
          }),
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.hasWorkspaceWideAccess).toBe(false);
    expect(
      result[0]?.workspace.installations.map((value) => value.accountLogin),
    ).toEqual(["acme"]);
    expect(result[0]?.workspace.gitLabInstallations).toEqual([]);
    expect(result[0]?.workspace.installations[0]?.githubInstallationId).toBe(
      "100",
    );
  });

  it("exposes all workspace installations only for authorized workspace-wide access", async () => {
    const h = harness();
    const result = await h.load(
      { kind: "workspace_ids", workspaceIds: ["ws_1"] },
      baseAccess,
    );
    expect(result[0]?.hasWorkspaceWideAccess).toBe(true);
    expect(result[0]?.workspace.installations).toHaveLength(2);
    expect(result[0]?.workspace.gitLabInstallations).toHaveLength(1);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["ws_1"] } } }),
    );
  });

  it("uses a distinct unscoped query only for globally authorized workspace access", async () => {
    const h = harness();
    const result = await h.load({ kind: "all" }, baseAccess);
    expect(result).toHaveLength(1);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
    expect(result[0]?.hasWorkspaceWideAccess).toBe(true);
  });

  it("sorts by active and usable repositories without mutating the database result", async () => {
    const secondary = {
      ...mainWorkspace,
      id: "ws_2",
      name: "Alpha",
      installations: [],
      gitLabInstallations: [],
      _count: { repositories: 2 },
    };
    const h = harness([mainWorkspace, secondary]);
    const result = await h.load({ kind: "all" }, baseAccess);
    expect(result.map((entry) => entry.workspace.id)).toEqual(["ws_2", "ws_1"]);
  });

  it("retains the empty-access workspace fallback without inventing rights", async () => {
    const empty = {
      ...mainWorkspace,
      installations: [],
      gitLabInstallations: [],
      _count: { repositories: 0 },
    };
    const h = harness([empty]);
    const result = await h.load({ kind: "all" }, baseAccess);
    expect(result.map((entry) => entry.workspace.id)).toEqual(["ws_1"]);
    expect(result[0]?.repositoryCount).toBe(0);
  });
});
