import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HistoryAccessError } from "@reviewrouter/features-review-history/contracts";
const mocks = vi.hoisted(() => ({ issues: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../../src/server/dashboard-mutations", () => ({
  getDashboardSignedInActor: async () => ({ userId: "authorized-actor" }),
}));
vi.mock("../../../../src/server/prisma", () => ({
  getPrisma: () => ({ marker: "test-database" }),
}));
vi.mock("@reviewrouter/features-review-statistics/composition", () => ({
  createReviewStatisticsFeature: async () => ({
    reader: { readIssues: mocks.issues },
  }),
}));
vi.mock("@reviewrouter/features-review-history/composition", () => ({
  createReviewHistoryFeature: async () => ({
    reader: { resolvePullRequests: mocks.resolve },
  }),
}));
import { GET } from "./issues/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.issues.mockResolvedValue({ items: [], nextCursor: null });
  mocks.resolve.mockResolvedValue({ state: "available", items: [] });
});
describe("Statistics supplemental History authorization at the real HTTP boundary", () => {
  it("binds a successful issue envelope to the server actor rather than a query actor", async () => {
    const response = await GET(
      new NextRequest(
        "https://local.invalid/api/dashboard/review-statistics/issues?workspaceId=workspace&actorId=forged&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-29T12%3A00%3A00.000Z",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { actorId: "authorized-actor", workspaceId: "workspace" },
      page: { items: [], nextCursor: null },
    });
    expect(mocks.resolve).toHaveBeenCalledWith({
      actorId: "authorized-actor",
      workspaceId: "workspace",
      pullRequests: [],
    });
  });
  it("returns a private403 without issues when the actual server mapping observes HistoryAccessError", async () => {
    mocks.resolve.mockRejectedValue(new HistoryAccessError());
    const response = await GET(
      new NextRequest(
        "https://local.invalid/api/dashboard/review-statistics/issues?workspaceId=workspace&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-29T12%3A00%3A00.000Z",
      ),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: "statistics_access_denied",
    });
  });
});
