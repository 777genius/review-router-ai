import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRepositoryScanSnapshot } from "./repository-scan";

afterEach(() => {
  vi.useRealTimers();
});

describe("loadRepositoryScanSnapshot", () => {
  it("reads the current install per account, then counts after the status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00.000Z"));
    const reads: string[] = [];
    const prisma = {
      gitHubInstallation: {
        findMany: vi.fn(async () => {
          reads.push("installations");
          return [
            {
              githubInstallationId: 100n,
              accountLogin: "octo-org",
              accountType: "Organization",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
            },
            {
              githubInstallationId: 200n,
              accountLogin: "octo-org",
              accountType: "Organization",
              createdAt: new Date("2026-11-17T11:59:30.000Z"),
            },
          ];
        }),
      },
      $queryRaw: vi.fn(async () => {
        reads.push("status");
        return [];
      }),
      repositoryConnection: {
        count: vi.fn(async () => {
          reads.push("count");
          return 0;
        }),
      },
    };

    const snapshot = await loadRepositoryScanSnapshot({
      prisma: prisma as never,
      workspaceId: "workspace-1",
    });

    expect(reads).toEqual(["installations", "status", "count"]);
    expect(prisma.gitHubInstallation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace-1", status: "active" },
      }),
    );
    expect(prisma.repositoryConnection.count).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1" },
    });
    // The stale install of the same account is ignored; the new one has no
    // scan request yet and is reported as queued.
    expect(snapshot).toEqual({
      checkedAt: "2026-11-17T12:00:00.000Z",
      repositoryCount: 0,
      installations: [
        {
          githubInstallationId: "200",
          accountLogin: "octo-org",
          state: "scanning",
          requestedAt: "2026-11-17T11:59:30.000Z",
        },
      ],
    });
  });
});
