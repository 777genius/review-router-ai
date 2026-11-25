import { describe, expect, it, vi } from "vitest";
import { settleReviewWorker } from "./settle-review-worker.js";

function clock() {
  let time = 0;
  const now = () => time;
  const pause = vi.fn(async (delayMs: number) => {
    time += delayMs;
  });
  return { now, monotonicNow: now, pause };
}

describe("Review v2 E2E worker settlement", () => {
  it("waits for scheduled publication eligibility", async () => {
    const timing = clock();
    let active = true;
    const runMaintenance = vi.fn(async () => {
      if (timing.now() >= 2594) active = false;
    });

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => active,
        nextEligibleAt: async () => new Date(2594),
        maxPasses: 32,
      }),
    ).resolves.toBe(true);

    expect(timing.pause).toHaveBeenCalledExactlyOnceWith(2594);
    expect(runMaintenance).toHaveBeenCalledTimes(2);
    expect(active).toBe(false);
  });

  it("returns immediately after actual settlement", async () => {
    const timing = clock();
    const runMaintenance = vi.fn(async () => {});
    const nextEligibleAt = vi.fn(async () => new Date(5000));

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => false,
        nextEligibleAt,
        maxPasses: 12,
      }),
    ).resolves.toBe(true);

    expect(runMaintenance).toHaveBeenCalledTimes(1);
    expect(nextEligibleAt).not.toHaveBeenCalled();
    expect(timing.pause).not.toHaveBeenCalled();
  });

  it.each([1, 3])("rejects active work after %i passes", async (maxPasses) => {
    const timing = clock();
    const runMaintenance = vi.fn(async () => {});
    const nextEligibleAt = vi.fn(async () => null);

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => true,
        nextEligibleAt,
        maxPasses,
      }),
    ).resolves.toBe(false);

    expect(runMaintenance).toHaveBeenCalledTimes(maxPasses);
    expect(nextEligibleAt).toHaveBeenCalledTimes(maxPasses - 1);
    expect(timing.pause).not.toHaveBeenCalled();
  });

  it("does not sleep while the next worker action is already due", async () => {
    const timing = clock();
    let passes = 0;
    const runMaintenance = vi.fn(async () => {
      passes += 1;
    });

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => passes < 2,
        nextEligibleAt: async () => new Date(0),
        maxPasses: 12,
      }),
    ).resolves.toBe(true);

    expect(runMaintenance).toHaveBeenCalledTimes(2);
    expect(timing.pause).not.toHaveBeenCalled();
  });

  it("caps retry waiting without accepting active work", async () => {
    const timing = clock();
    const runMaintenance = vi.fn(async () => {});

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => true,
        nextEligibleAt: async () => new Date(5000),
        maxPasses: 32,
        timeoutMs: 1000,
      }),
    ).resolves.toBe(false);

    expect(timing.pause).toHaveBeenCalledExactlyOnceWith(1000);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });

  it("includes maintenance time in its monotonic budget", async () => {
    const timing = clock();
    const runMaintenance = vi.fn(async () => {
      await timing.pause(1000);
    });
    const nextEligibleAt = vi.fn(async () => new Date(5000));

    await expect(
      settleReviewWorker({
        ...timing,
        runMaintenance,
        hasActiveWork: async () => true,
        nextEligibleAt,
        maxPasses: 32,
        timeoutMs: 1000,
      }),
    ).resolves.toBe(false);

    expect(runMaintenance).toHaveBeenCalledTimes(1);
    expect(nextEligibleAt).not.toHaveBeenCalled();
    expect(timing.pause).toHaveBeenCalledTimes(1);
  });
});
