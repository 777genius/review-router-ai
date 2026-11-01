import { describe, expect, it, vi } from "vitest";
import { timeAnalyticsRead } from "./analytics-read-timing";

describe("slow analytics reads", () => {
  it("logs only bounded, slow analytics operations", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const operation = "statistics.report";
      const fastRead = async () => 42;
      const fastResult = await timeAnalyticsRead(operation, fastRead, () => 0);
      expect(fastResult).toBe(42);
      expect(log).not.toHaveBeenCalled();

      const times = [0, 2_120];
      const failedRead = async () => {
        throw new Error("read_failed");
      };
      const nextTime = () => times.shift() ?? 2_120;
      const failure = timeAnalyticsRead("usage.report", failedRead, nextTime);
      await expect(failure).rejects.toThrow("read_failed");
      expect(log).toHaveBeenCalledExactlyOnceWith("analytics_read_slow", {
        operation: "usage.report",
        durationBucketMs: 2_500,
      });

      const longTimes = [0, 120_000];
      const nextLongTime = () => longTimes.shift() ?? 120_000;
      await timeAnalyticsRead(operation, async () => 7, nextLongTime);
      expect(log).toHaveBeenLastCalledWith("analytics_read_slow", {
        operation: "statistics.report",
        durationBucketMs: 30_000,
      });
    } finally {
      log.mockRestore();
    }
  });
});
