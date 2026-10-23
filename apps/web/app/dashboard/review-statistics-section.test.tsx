import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatisticsAccessError } from "@reviewrouter/features-review-statistics";
import { statisticsFixture } from "../../src/features/review-statistics/statistics.test-fixtures";
const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn() }));
vi.mock("../../src/server/review-statistics", async () => ({
  ...(await vi.importActual<
    typeof import("../../src/server/review-statistics")
  >("../../src/server/review-statistics")),
  loadStatisticsReport: mocks.load,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { ReviewStatisticsSection } from "./review-statistics-section";
afterEach(() => vi.clearAllMocks());
describe("Statistics server section", () => {
  it("passes an authorized report with a new seed generation on each server render", async () => {
    mocks.load.mockResolvedValue({
      actorId: "actor-a",
      report: statisticsFixture(),
    });
    const first = await ReviewStatisticsSection({ workspaceId: "workspace-a" });
    const second = await ReviewStatisticsSection({
      workspaceId: "workspace-a",
    });
    expect(first.props).toMatchObject({
      actorId: "actor-a",
      workspaceId: "workspace-a",
      initialReport: statisticsFixture(),
    });
    expect(first.props.seedId).not.toBe(second.props.seedId);
  });
  it.each([new Error("database unavailable"), new StatisticsAccessError()])(
    "catches initial errors inside the section and provides retry",
    async (error) => {
      mocks.load.mockRejectedValue(error);
      const content = renderToStaticMarkup(
        await ReviewStatisticsSection({ workspaceId: "workspace-a" }),
      );
      expect(content).toContain('id="dashboard-section-content"');
      expect(content).toContain("Statistics");
      expect(content).toContain("Retry statistics");
      expect(content).not.toContain("All-severity review summary");
      expect(content).not.toContain("database unavailable");
    },
  );
});
