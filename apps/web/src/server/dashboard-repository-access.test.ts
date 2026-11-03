import { describe, expect, it, vi } from "vitest";
import {
  createDashboardRepositoryAccessLoader,
  dashboardRepositoryVisibilityChanged,
  normalizeRequestedRepositoryFullName,
} from "./dashboard-repository-access";
import type { DashboardMutationActor } from "./dashboard-mutations";

const actor: DashboardMutationActor = {
  userId: "user_1",
  sourceProvider: "github",
  externalUserId: "101",
  sourceLogin: "alice",
  githubUserId: "101",
  githubLogin: "alice",
  actor: "alice",
};
const discovered = {
  status: "ready" as const,
  workspaceIds: ["ws_existing"],
  repositoryIds: new Set(["repo_existing"]),
  directConfigRepositoryIds: new Set(["repo_existing"]),
  checkedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const repository = {
  id: "repo_candidate",
  workspaceId: "ws_candidate",
  fullName: "acme/widget",
  githubRepositoryId: 123n,
  owner: "acme",
  name: "widget",
  installation: { githubInstallationId: 456n },
};
function harness(options?: {
  readonly canMutate?: boolean;
  readonly canConfigure?: boolean;
}) {
  const findMany = vi.fn().mockResolvedValue([repository, repository]);
  const listAccess = vi.fn().mockResolvedValue(discovered);
  const canMutate = vi.fn().mockResolvedValue(options?.canMutate ?? false);
  const canConfigure = vi
    .fn()
    .mockResolvedValue(options?.canConfigure ?? false);
  const load = createDashboardRepositoryAccessLoader({
    getPrisma: (() => ({
      repositoryConnection: { findMany },
    })) as unknown as Parameters<
      typeof createDashboardRepositoryAccessLoader
    >[0]["getPrisma"],
    listAccess: listAccess as unknown as Parameters<
      typeof createDashboardRepositoryAccessLoader
    >[0]["listAccess"],
    canMutate: canMutate as unknown as Parameters<
      typeof createDashboardRepositoryAccessLoader
    >[0]["canMutate"],
    canConfigure: canConfigure as unknown as Parameters<
      typeof createDashboardRepositoryAccessLoader
    >[0]["canConfigure"],
  });
  return { load, findMany, listAccess, canMutate, canConfigure };
}
const input = {
  actor,
  workspaceScope: {
    kind: "workspace_ids" as const,
    workspaceIds: [] as string[],
  },
  requestedRepositoryFullName: "acme/widget",
};

describe("dashboard repository access boundary", () => {
  it("does not discover or query candidates without an authenticated GitHub actor", async () => {
    const h = harness();
    const anonymous = await h.load({
      ...input,
      actor: null,
      workspaceScope: { kind: "none", reason: "signed_out" },
    });
    expect(anonymous.status).toBe("ready");
    expect([...anonymous.repositoryIds]).toEqual([]);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.listAccess).not.toHaveBeenCalled();

    const gitlab = await h.load({
      ...input,
      actor: { ...actor, sourceProvider: "gitlab" },
    });
    expect(gitlab.repositoryIds.size).toBe(0);
    expect(h.listAccess).not.toHaveBeenCalled();
  });

  it("never uses a requested repository to expand global workspace access", async () => {
    const h = harness();
    const access = await h.load({
      ...input,
      workspaceScope: { kind: "all", reason: "local_admin_override" },
    });
    expect(access.repositoryIds.size).toBe(0);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.listAccess).not.toHaveBeenCalled();
  });

  it("does not select candidates for invalid names", async () => {
    const h = harness();
    const result = await h.load({
      ...input,
      requestedRepositoryFullName: "acme/widget/../admin",
    });
    expect(result).toEqual(discovered);
    expect(h.listAccess).toHaveBeenCalledOnce();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("deduplicates a candidate and never elevates denied permissions", async () => {
    const h = harness({ canMutate: false });
    const access = await h.load({ ...input, baseAccess: discovered });
    expect([...access.repositoryIds]).toEqual(["repo_existing"]);
    expect([...access.workspaceIds]).toEqual(["ws_existing"]);
    expect([...access.directConfigRepositoryIds]).toEqual(["repo_existing"]);
    expect(h.canMutate).toHaveBeenCalledOnce();
    expect(h.canConfigure).not.toHaveBeenCalled();
    expect(h.listAccess).not.toHaveBeenCalled();
  });

  it("grants direct configuration only after both explicit permission checks", async () => {
    const h = harness({ canMutate: true, canConfigure: false });
    const result = await h.load({ ...input, baseAccess: discovered });
    expect(result.repositoryIds.has("repo_candidate")).toBe(true);
    expect(result.workspaceIds).toContain("ws_candidate");
    expect(result.directConfigRepositoryIds.has("repo_candidate")).toBe(false);
    expect(h.canMutate).toHaveBeenCalledOnce();
    expect(h.canConfigure).toHaveBeenCalledOnce();
  });

  it("includes directly configurable repositories only after permission succeeds", async () => {
    const h = harness({ canMutate: true, canConfigure: true });
    const result = await h.load({ ...input, baseAccess: discovered });
    expect(result.directConfigRepositoryIds.has("repo_candidate")).toBe(true);
    expect(h.listAccess).not.toHaveBeenCalled();
  });

  it("keeps an unknown discovery status fail-closed", async () => {
    const h = harness({ canMutate: true, canConfigure: true });
    const unavailable = { ...discovered, status: "github_error" as const };
    const result = await h.load({ ...input, baseAccess: unavailable });
    expect(result).toEqual(unavailable);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.canMutate).not.toHaveBeenCalled();
  });

  it("excludes the full-access workspaces when looking for a directly requested repo", async () => {
    const h = harness({ canMutate: false });
    await h.load({
      ...input,
      workspaceScope: { kind: "workspace_ids", workspaceIds: ["ws_full"] },
    });
    expect(h.listAccess).toHaveBeenCalledWith(
      expect.objectContaining({ excludedWorkspaceIds: ["ws_full"] }),
    );
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: { notIn: ["ws_full"] },
          selected: true,
          archived: false,
        }),
      }),
    );
  });

  it("normalizes only full repository names and detects visibility changes", () => {
    expect(normalizeRequestedRepositoryFullName("  acme/widget  ")).toBe(
      "acme/widget",
    );
    expect(normalizeRequestedRepositoryFullName("acme")).toBeNull();
    expect(normalizeRequestedRepositoryFullName("../acme/widget")).toBeNull();
    const previous = discovered;
    expect(
      dashboardRepositoryVisibilityChanged(previous, { ...previous }),
    ).toBe(false);
    expect(
      dashboardRepositoryVisibilityChanged(previous, {
        ...previous,
        repositoryIds: new Set(["repo_existing", "repo_new"]),
      }),
    ).toBe(true);
  });
});
