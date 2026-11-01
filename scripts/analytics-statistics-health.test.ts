import { describe, expect, it } from "vitest";
import { summarizeStatisticsQueue } from "./analytics-statistics-health";

describe("statistics processing health", () => {
  it("separates pending work from dead letters", () => {
    expect(
      summarizeStatisticsQueue([
        { status: "pending", count: "2", oldest: "2026-10-31T09:00:00.000Z" },
        {
          status: "retry_wait",
          count: "1",
          oldest: "2026-10-31T08:00:00.000Z",
        },
        {
          status: "dead_letter",
          count: "3",
          oldest: "2026-10-25T00:00:00.000Z",
        },
      ]),
    ).toEqual({
      outstanding: 3,
      deadLetters: 3,
      oldestOutstandingAt: "2026-10-31T08:00:00.000Z",
      byStatus: { pending: 2, processing: 0, retry_wait: 1, dead_letter: 3 },
    });
    expect(summarizeStatisticsQueue([])).toMatchObject({
      outstanding: 0,
      deadLetters: 0,
      oldestOutstandingAt: null,
    });
    expect(() =>
      summarizeStatisticsQueue([{ status: "processed", count: "1" }]),
    ).toThrow("unexpected_statistics_queue_status");
  });
});
