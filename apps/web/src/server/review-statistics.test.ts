import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StatisticsAccessError,
  StatisticsSeverity,
  StatisticsValidationError,
} from "@reviewrouter/features-review-statistics";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  composition: vi.fn(),
  report: vi.fn(),
  issues: vi.fn(),
  prisma: { marker: "db" },
}));
vi.mock("./dashboard-mutations", () => ({
  getDashboardSignedInActor: mocks.actor,
}));
vi.mock("./prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@reviewrouter/features-review-statistics/composition", () => ({
  createReviewStatisticsFeature: mocks.composition,
}));
import {
  loadStatisticsIssues,
  loadStatisticsReport,
  readStatisticsFilter,
  statisticsErrorStatus,
} from "./review-statistics";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ userId: "session-user" });
  mocks.composition.mockResolvedValue({
    reader: { readReport: mocks.report, readIssues: mocks.issues },
  });
});
describe("Statistics server adapter", () => {
  it("resolves the signed-in actor server-side and never forwards a client actor", async () => {
    mocks.report.mockResolvedValue({ totals: {} });
    await loadStatisticsReport(
      "workspace-a",
      readStatisticsFilter(
        new URLSearchParams({
          days: "7",
          severity: "major",
          actorId: "forged",
        }),
      ),
    );
    expect(mocks.actor).toHaveBeenCalledWith({ readOnly: true });
    expect(mocks.composition).toHaveBeenCalledWith({ prisma: mocks.prisma });
    expect(mocks.report).toHaveBeenCalledWith({
      actorId: "session-user",
      workspaceId: "workspace-a",
      filter: { days: 7, severity: StatisticsSeverity.Major },
    });
  });
  it("requires a signed-in actor before constructing readers", async () => {
    mocks.actor.mockResolvedValue(null);
    try {
      await loadStatisticsReport("workspace-a");
      throw new Error("expected denial");
    } catch (error) {
      expect(statisticsErrorStatus(error)).toBe(401);
    }
    expect(mocks.composition).not.toHaveBeenCalled();
  });
  it.each([
    { days: "0" },
    { days: "7.0" },
    { days: "91" },
    { severity: "severe" },
    { days: "-7" },
  ])("rejects noncontract report filters %s", (params) => {
    expect(() => readStatisticsFilter(new URLSearchParams(params))).toThrow(
      StatisticsValidationError,
    );
  });
  it("retains exact issue scope and lets the authorized reader validate cursors/dates", async () => {
    const params = new URLSearchParams({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-23T12:00:00.000Z",
      severity: "unknown",
      repositoryId: "repo-a",
      cursor: "opaque",
    });
    await loadStatisticsIssues("workspace-a", params);
    expect(mocks.issues).toHaveBeenCalledWith({
      actorId: "session-user",
      workspaceId: "workspace-a",
      from: params.get("from"),
      to: params.get("to"),
      severity: StatisticsSeverity.Unknown,
      repositoryId: "repo-a",
      cursor: "opaque",
    });
  });
  it("maps bounded public errors without exposing infrastructure details", () => {
    expect(statisticsErrorStatus(new StatisticsAccessError())).toBe(403);
    expect(statisticsErrorStatus(new StatisticsValidationError())).toBe(400);
    expect(statisticsErrorStatus(new Error("sensitive DB error"))).toBe(500);
  });
});
