import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainReviewActionV2Worker } from "./review-action-v2-worker-drain.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function fixture() {
  const cancellation = new AbortController();
  const runMaintenance = vi.fn(async () => undefined);
  const hasActiveCompletion = vi.fn(async () => true);
  const nextEligibleAt = vi.fn(async (): Promise<Date | null> => null);
  const closed = new Error("review_v2_e2e_worker_closed");
  return {
    runMaintenance,
    hasActiveCompletion,
    nextEligibleAt,
    closed,
    close: () => cancellation.abort(closed),
    run: (maxPasses = 12) =>
      drainReviewActionV2Worker(
        {
          runMaintenance,
          hasActiveCompletion,
          nextEligibleAt,
          signal: cancellation.signal,
        },
        maxPasses,
      ),
  };
}

describe("Review v2 E2E worker drain", () => {
  it.each([874, 2_594, 5_000])(
    "waits for a deferred retry in %i ms before spending another pass",
    async (delayMs) => {
      const worker = fixture();
      worker.hasActiveCompletion
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      worker.nextEligibleAt.mockResolvedValue(new Date(Date.now() + delayMs));

      const pending = worker.run();
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      expect(worker.runMaintenance).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(true);
      expect(worker.runMaintenance).toHaveBeenCalledTimes(2);
      expect(worker.nextEligibleAt).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("runs already-due work immediately without installing a timer", async () => {
    const worker = fixture();
    worker.hasActiveCompletion
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    worker.nextEligibleAt.mockResolvedValue(new Date(Date.now()));
    const startedAt = Date.now();

    await expect(worker.run(2)).resolves.toBe(true);

    expect(worker.runMaintenance).toHaveBeenCalledTimes(2);
    expect(Date.now()).toBe(startedAt);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves one-pass fault probes without reading deadlines or waiting", async () => {
    const worker = fixture();
    worker.nextEligibleAt.mockRejectedValue(
      new Error("deadline_read_must_not_run"),
    );

    await expect(worker.run(1)).resolves.toBe(false);

    expect(worker.runMaintenance).toHaveBeenCalledTimes(1);
    expect(worker.hasActiveCompletion).toHaveBeenCalledTimes(1);
    expect(worker.nextEligibleAt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one 5-second wait budget across all passes", async () => {
    const worker = fixture();
    worker.nextEligibleAt
      .mockResolvedValueOnce(new Date(Date.now() + 4_000))
      .mockImplementationOnce(async () => new Date(Date.now() + 1_001));
    const startedAt = Date.now();

    const pending = worker.run();
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(pending).resolves.toBe(false);
    expect(worker.runMaintenance).toHaveBeenCalledTimes(2);
    expect(worker.nextEligibleAt).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBe(4_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending retry on close without another maintenance call", async () => {
    const worker = fixture();
    worker.nextEligibleAt.mockResolvedValue(new Date(Date.now() + 4_000));
    const pending = worker.run();
    const rejected = expect(pending).rejects.toBe(worker.closed);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    worker.close();

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(worker.runMaintenance).toHaveBeenCalledTimes(1);
    await expect(worker.run()).rejects.toBe(worker.closed);
    expect(worker.runMaintenance).toHaveBeenCalledTimes(1);
  });

  it("does not install a retry timer when close happens during the deadline read", async () => {
    const worker = fixture();
    worker.nextEligibleAt.mockImplementation(async () => {
      worker.close();
      return new Date(Date.now() + 4_000);
    });

    await expect(worker.run()).rejects.toBe(worker.closed);

    expect(worker.runMaintenance).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
