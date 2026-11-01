import { describe, expect, it, vi } from "vitest";
import { timeAnalyticsRead } from "./analytics-read-timing";

describe("slow analytics reads", () => {
  it("logs only bounded, slow analytics operations", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(
        await timeAnalyticsRead("statistics.report", async () => 42, () => 0),
      ).toBe(42);
      expect(log).not.toHaveBeenCalled();
      const times = [0, 2_120];
      await expect(
        timeAnalyticsRead(
          "usage.report",
          async () => {
            throw new Error("read_failed");
          },
          () => times.shift() ?? 2_120,
        ),
      ).rejects.toThrow("read_failed");
      expect(log).toHaveBeenCalledExactlyOnceWith("analytics_read_slow", {
        operation: "usage.report",
        durationBucketMs: 2_500,
      });
      const longTimes = [0, 120_000];
      await timeAnalyticsRead("statistics.report", async () => 7, () =>
        longTimes.shift() ?? 120_000,
      );
      expect(log).toHaveBeenLastCalledWith("analytics_read_slow", {
        operation: "statistics.report",
        durationBucketMs: 30_000,
      });
    } finally {
      log.mockRestore();
    }
  });
});
