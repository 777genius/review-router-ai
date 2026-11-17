import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getDashboardWorkspaceScope: vi.fn(),
  loadRepositoryScanSnapshot: vi.fn(),
}));

vi.mock("../../../../../src/server/dashboard-mutations", () => ({
  getDashboardWorkspaceScope: mocks.getDashboardWorkspaceScope,
}));
vi.mock("../../../../../src/server/prisma", () => ({
  getPrisma: () => ({}),
}));
vi.mock("../../../../../src/server/repository-scan", () => ({
  loadRepositoryScanSnapshot: mocks.loadRepositoryScanSnapshot,
}));

const snapshot = {
  installations: [],
  repositoryCount: 0,
  checkedAt: "2026-11-17T12:00:00.000Z",
};

function get(workspace: string) {
  return GET(
    new NextRequest(
      `https://reviewrouter.test/api/dashboard/repositories/scan?workspace=${workspace}`,
    ),
  );
}

describe("GET /api/dashboard/repositories/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadRepositoryScanSnapshot.mockResolvedValue(snapshot);
  });

  it("requires sign-in", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "none",
      reason: "signed_out",
    });
    expect((await get("workspace-1")).status).toBe(401);
    expect(mocks.loadRepositoryScanSnapshot).not.toHaveBeenCalled();
  });

  it("refuses a workspace without owner or admin access", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace-2"],
    });
    expect((await get("workspace-1")).status).toBe(403);
    expect(mocks.loadRepositoryScanSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a missing workspace and reports a failed read safely", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "all",
      reason: "local_admin_override",
    });
    expect((await get("")).status).toBe(400);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadRepositoryScanSnapshot.mockRejectedValueOnce(
      new Error("permission denied for table OutboxEvent"),
    );
    const response = await get("workspace-1");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "repository_scan_unavailable",
    });
    expect(log).toHaveBeenCalledWith("repository_scan_read_failed", {
      workspaceId: "workspace-1",
    });
    log.mockRestore();
  });

  it("returns the scan of an accessible workspace without caching", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace-1"],
    });
    const response = await get("workspace-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(snapshot);
    expect(mocks.loadRepositoryScanSnapshot).toHaveBeenCalledWith({
      prisma: {},
      workspaceId: "workspace-1",
    });
  });
});
