import { describe, expect, it } from "vitest";
import { StatisticsSeverity } from "@reviewrouter/features-review-statistics";
import {
  defaultStatisticsFilter,
  statisticsFilterFromUrl,
  statisticsFilterUrl,
  statisticsSearchParams,
} from "./statistics-url";

describe("Statistics shared URL", () => {
  it("uses the same exact filters for SSR arrays and browser params", () => {
    expect(statisticsFilterFromUrl(new URLSearchParams())).toEqual(
      defaultStatisticsFilter,
    );
    expect(
      statisticsFilterFromUrl(
        statisticsSearchParams({
          statisticsDays: "7",
          statisticsSeverity: "major",
        }),
      ),
    ).toEqual({ days: 7, severity: "major" });
    expect(
      statisticsFilterFromUrl(
        statisticsSearchParams({ statisticsDays: ["7", "7"] }),
      ),
    ).toBeNull();
  });
  it.each(["", "07", "7.0", "+7", "7e0", " 7", "7 ", "1", "NaN"])(
    "rejects invalid period %j",
    (value) => {
      expect(
        statisticsFilterFromUrl(new URLSearchParams({ statisticsDays: value })),
      ).toBeNull();
    },
  );
  it.each(["", "Major", " major", "other"])(
    "rejects invalid severity %j",
    (value) => {
      expect(
        statisticsFilterFromUrl(
          new URLSearchParams({ statisticsSeverity: value }),
        ),
      ).toBeNull();
    },
  );
  it("resets every known occurrence and preserves unrelated scope and hash", () => {
    const href =
      "https://local.invalid/dashboard?section=statistics&workspace=team&statisticsDays=7&statisticsDays=90&statisticsSeverity=major&keep=a&keep=b#issues";
    expect(statisticsFilterUrl(href, defaultStatisticsFilter)).toBe(
      "/dashboard?section=statistics&workspace=team&keep=a&keep=b#issues",
    );
    expect(
      statisticsFilterUrl(href, {
        days: 90,
        severity: StatisticsSeverity.Critical,
      }),
    ).toBe(
      "/dashboard?section=statistics&workspace=team&keep=a&keep=b&statisticsDays=90&statisticsSeverity=critical#issues",
    );
  });
});
