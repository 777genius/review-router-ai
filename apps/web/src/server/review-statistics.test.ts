import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StatisticsAccessError,
  StatisticsSeverity,
  StatisticsValidationError,
} from "@reviewrouter/features-review-statistics";
import { HistoryAccessError } from "@reviewrouter/features-review-history/contracts";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  composition: vi.fn(),
  report: vi.fn(),
  issues: vi.fn(),
  historyComposition: vi.fn(),
  resolve: vi.fn(),
  prisma: { marker: "db" },
}));
vi.mock("./dashboard-mutations", () => ({
  getDashboardSignedInActor: mocks.actor,
}));
vi.mock("./prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@reviewrouter/features-review-statistics/composition", () => ({
  createReviewStatisticsFeature: mocks.composition,
}));
vi.mock("@reviewrouter/features-review-history/composition", () => ({
  createReviewHistoryFeature: mocks.historyComposition,
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
  mocks.issues.mockResolvedValue({ items: [], nextCursor: null });
  mocks.resolve.mockResolvedValue({ state: "available", items: [] });
  mocks.historyComposition.mockResolvedValue({
    reader: { resolvePullRequests: mocks.resolve },
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
  const issue = {
    id: "issue",
    title: "Recorded finding",
    severity: StatisticsSeverity.Major,
    repositoryId: "connection-before-unbind",
    repositoryFullName: "renamed/repository",
    scmRepositoryIdentityId: "immutable-scm",
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/renamed/repository/pull/7",
    caughtAt: "2026-10-23T10:00:00.000Z",
  };
  const issueParams = () =>
    new URLSearchParams({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-23T12:00:00.000Z",
    });
  it("maps immutable captured SCM identities through one public History batch and links without date or status constraints", async () => {
    mocks.issues.mockResolvedValue({
      items: [
        issue,
        { ...issue, id: "different", scmRepositoryIdentityId: "other-scm" },
      ],
      nextCursor: "next",
    });
    mocks.resolve.mockResolvedValue({
      state: "available",
      items: [
        {
          id: "history-pr",
          scmRepositoryIdentityId: "immutable-scm",
          pullRequestNumber: 7,
        },
      ],
    });
    const result = await loadStatisticsIssues("workspace-a", issueParams());
    expect(result.scope).toEqual({
      actorId: "session-user",
      workspaceId: "workspace-a",
    });
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith({
      actorId: "session-user",
      workspaceId: "workspace-a",
      pullRequests: [
        { scmRepositoryIdentityId: "immutable-scm", pullRequestNumber: 7 },
        { scmRepositoryIdentityId: "other-scm", pullRequestNumber: 7 },
      ],
    });
    expect(result.page.nextCursor).toBe("next");
    expect(result.page.items[1]?.history).toEqual({ status: "not_recorded" });
    const link = result.page.items[0]?.history;
    expect(link?.status).toBe("linked");
    if (link?.status !== "linked") throw new Error("expected_history_link");
    const url = new URL(link.href, "https://local.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      section: "reviews",
      workspace: "workspace-a",
      reviewRepository: "immutable-scm",
      reviewSearch: "7",
    });
  });
  it("keeps issues and external links when optional history is temporarily unavailable", async () => {
    mocks.issues.mockResolvedValue({ items: [issue], nextCursor: null });
    mocks.resolve.mockResolvedValue({ state: "unavailable" });
    const result = await loadStatisticsIssues("workspace-a", issueParams());
    expect(result.page.items).toEqual([
      { ...issue, history: { status: "temporarily_unavailable" } },
    ]);
  });
  it("translates History denial into Statistics denial and propagates programming defects", async () => {
    mocks.resolve.mockRejectedValueOnce(new HistoryAccessError());
    await expect(
      loadStatisticsIssues("workspace-a", issueParams()),
    ).rejects.toBeInstanceOf(StatisticsAccessError);
    const defect = new Error("programming defect");
    mocks.resolve.mockRejectedValueOnce(defect);
    await expect(
      loadStatisticsIssues("workspace-a", issueParams()),
    ).rejects.toBe(defect);
  });
});
