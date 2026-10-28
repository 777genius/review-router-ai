import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  issues: vi.fn(),
  filter: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../../../../src/server/review-statistics", () => ({
  loadStatisticsReport: mocks.report,
  loadStatisticsIssues: mocks.issues,
  readStatisticsFilter: mocks.filter,
  statisticsErrorStatus: mocks.status,
}));
import { GET } from "./route";
import { GET as GETIssues } from "./issues/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.filter.mockReturnValue({ days: 30, severity: "all" });
});
describe("Statistics private routes", () => {
  it.each([GET, GETIssues])(
    "requires workspace and makes malformed responses private",
    async (handler) => {
      const response = await handler(
        new NextRequest(
          "https://local.invalid/api/dashboard/review-statistics",
        ),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("returns report DTO without actor cache metadata", async () => {
    mocks.report.mockResolvedValue({
      actorId: "private-session-user",
      report: { totals: { reviews: 3 } },
    });
    const response = await GET(
      new NextRequest(
        "https://local.invalid/api/dashboard/review-statistics?workspaceId=workspace-a&days=30&severity=all",
      ),
    );
    expect(await response.json()).toEqual({ totals: { reviews: 3 } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.report).toHaveBeenCalledWith("workspace-a", {
      days: 30,
      severity: "all",
    });
  });
  it.each([400, 401, 403, 500])(
    "returns safe no-store errors for status %s from either reader",
    async (status) => {
      const error = new Error("do not expose database credentials");
      mocks.status.mockReturnValue(status);
      mocks.report.mockRejectedValue(error);
      mocks.issues.mockRejectedValue(error);
      for (const handler of [GET, GETIssues]) {
        const response = await handler(
          new NextRequest(
            "https://local.invalid/api/dashboard/review-statistics?workspaceId=workspace-a",
          ),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(JSON.stringify(await response.json())).not.toContain(
          "credentials",
        );
      }
    },
  );
  it("retains exact issue request params", async () => {
    mocks.issues.mockResolvedValue({ items: [], nextCursor: null });
    const response = await GETIssues(
      new NextRequest(
        "https://local.invalid/api/dashboard/review-statistics/issues?workspaceId=workspace-a&from=2026-10-01&to=2026-10-23&severity=minor&cursor=opaque",
      ),
    );
    expect(response.status).toBe(200);
    const params = mocks.issues.mock.calls[0]![1] as URLSearchParams;
    expect(params.get("from")).toBe("2026-10-01");
    expect(params.get("cursor")).toBe("opaque");
  });
});
