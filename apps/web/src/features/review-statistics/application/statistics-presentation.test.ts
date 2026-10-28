import { describe, expect, it } from "vitest";
import { StatisticsDayCoverage } from "@reviewrouter/features-review-statistics";
import { statisticsFixture } from "../statistics.test-fixtures";
import {
  changeLabel,
  chartRows,
  instantLabel,
} from "./statistics-presentation";
describe("Statistics presentation", () => {
  it("formats UTC midnight with a zero-based two-digit hour", () => {
    expect(instantLabel("2026-10-24T00:01:00.000Z")).toBe(
      "Oct 24, 2026, 00:01",
    );
  });
  it("avoids infinity and handles every zero-baseline case", () => {
    expect(changeLabel(0, 0)).toBe("No change");
    expect(changeLabel(4, 0)).toBe("+4 · new activity");
    expect(changeLabel(0, 4)).toBe("−100%");
    expect(changeLabel(3, 2)).toBe("+50%");
  });
  it("maps unavailable history to missing chart values and preserves partial counts", () => {
    const report = statisticsFixture();
    const daily = [...report.daily];
    daily[0] = { ...daily[0]!, coverage: StatisticsDayCoverage.Unavailable };
    daily[1] = {
      ...daily[1]!,
      coverage: StatisticsDayCoverage.Partial,
      reviews: 9,
    };
    const rows = chartRows({ ...report, daily });
    expect(rows[0]).toMatchObject({
      reviews: null,
      pullRequestsReviewed: null,
      critical: null,
    });
    expect(rows[1]).toMatchObject({ reviews: 9 });
  });
});
