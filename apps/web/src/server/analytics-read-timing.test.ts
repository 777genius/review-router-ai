import { describe, expect, it, vi } from "vitest";
import { timeAnalyticsRead } from "./analytics-read-timing";

describe("slow analytics reads", () => {
  it("keeps fast reads quiet and records only bounded operation/duration", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await timeAnalyticsRead("statistics.report", async () => 42, () => 0))
        .toBe(42);
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
    } finally {
      log.mockRestore();
    }
  });
});
