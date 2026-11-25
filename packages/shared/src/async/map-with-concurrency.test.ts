import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./index";

describe("mapWithConcurrency", () => {
  it("keeps the input order and never runs more mappers than the limit", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency(
      [30, 5, 20, 1, 10],
      2,
      async (delay, index) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, delay));
        running -= 1;
        return `${index}:${delay}`;
      },
    );
    expect(result).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"]);
    expect(peak).toBe(2);
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(
      "map_with_concurrency_limit_invalid",
    );
  });

  it("starts no further mapper after the first rejection", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency(
        Array.from({ length: 20 }, (_, index) => index),
        3,
        async (value) => {
          started.push(value);
          if (value === 1) throw new Error("permission_check_failed");
          await new Promise((resolve) => setTimeout(resolve, 5));
          return value;
        },
      ),
    ).rejects.toThrow("permission_check_failed");
    // Let anything still running settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toEqual([0, 1, 2]);
  });
});
