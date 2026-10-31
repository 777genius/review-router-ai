import { describe, expect, it } from "vitest";
import { statisticsMetricCatalog, statisticsTotalForMetric } from "../application/metric-catalog";

describe("Statistics metric catalog", () => {
  it("exposes only real report totals and supported groupings", () => {
    expect(new Set(statisticsMetricCatalog.map((metric) => metric.id)).size).toBe(3);
    expect(statisticsMetricCatalog.map((metric) => metric.valueKey)).toEqual([
      "reviews", "pullRequestsReviewed", "issuesCaught",
    ]);
    expect(statisticsMetricCatalog.find((metric) => metric.id === "reviews.unique_prs"))
      .toMatchObject({ aggregation: "distinct", dimensions: ["day"] });
    expect(statisticsTotalForMetric(
      { reviews: 3, pullRequestsReviewed: 2, issuesCaught: 1, repositoriesWithIssues: 1 },
      statisticsMetricCatalog[1]!,
    )).toBe(2);
    expect(statisticsMetricCatalog.every((metric) => metric.version === 1)).toBe(true);
  });
});
