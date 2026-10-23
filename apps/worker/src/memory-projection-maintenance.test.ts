import { describe, expect, it, vi } from "vitest";
import {
  createMemoryProjectionMaintenance,
  readMemoryProjectionMaintenanceConfig,
} from "./memory-projection-maintenance";

describe("memory projection maintenance", () => {
  it("runs a bounded batch immediately and respects the host interval", async () => {
    let nowMs = 0;
    const reconcile = vi.fn(async () => ({
      processed: 3,
      deleted: 2,
      pending: 1,
    }));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const maintain = createMemoryProjectionMaintenance(
      { intervalMs: 30_000, limit: 3 },
      { clock: { now: () => new Date(nowMs) }, reconcile, logger },
    );

    await maintain();
    await maintain();
    nowMs = 29_999;
    await maintain();
    expect(reconcile).toHaveBeenCalledExactlyOnceWith({ limit: 3 });
    nowMs = 30_000;
    await maintain();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "ReviewRouter reconciled memory projections",
      { processed: 3, deleted: 2, pending: 1 },
    );
  });

  it("does not start an overlapping pass and retains its actual in-flight work", async () => {
    let settle: (() => void) | undefined;
    let nowMs = 0;
    const reconcile = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        settle = resolve;
      });
      return { processed: 1, deleted: 1, pending: 0 };
    });
    const maintain = createMemoryProjectionMaintenance(
      { intervalMs: 10, limit: 1 },
      {
        clock: { now: () => new Date(nowMs) },
        reconcile,
        logger: { info: vi.fn(), warn: vi.fn() },
      },
    );
    const firstPass = maintain();
    nowMs = 100;
    await maintain();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(settle).toBeDefined();
    settle!();
    await firstPass;
  });

  it("keeps provider error sentinels out of logs and lets later worker work continue", async () => {
    let nowMs = 0;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const reconcile = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("secret-body-sentinel query-sentinel token-sentinel"),
      )
      .mockResolvedValue({ processed: 0, deleted: 0, pending: 0 });
    const maintain = createMemoryProjectionMaintenance(
      { intervalMs: 10, limit: 2 },
      { clock: { now: () => new Date(nowMs) }, reconcile, logger },
    );
    await expect(maintain()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "ReviewRouter memory projection maintenance failed",
      { errorCode: "memory_projection_maintenance_failed" },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sentinel");
    nowMs = 10;
    await maintain();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("uses bounded defaults and refuses invalid operator limits", () => {
    expect(readMemoryProjectionMaintenanceConfig({})).toEqual({
      intervalMs: 30_000,
      limit: 10,
    });
    expect(() =>
      readMemoryProjectionMaintenanceConfig({
        REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_BATCH_SIZE: "101",
      }),
    ).toThrow("memory_projection_reconcile_batch_size_invalid");
    expect(() =>
      readMemoryProjectionMaintenanceConfig({
        REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_INTERVAL_MS: "0",
      }),
    ).toThrow("memory_projection_reconcile_interval_invalid");
    expect(() =>
      readMemoryProjectionMaintenanceConfig({
        REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_INTERVAL_MS: "1e6",
      }),
    ).toThrow("memory_projection_reconcile_interval_invalid");
    const reconcile = vi.fn();
    expect(() =>
      createMemoryProjectionMaintenance(
        { intervalMs: 1, limit: 0 },
        {
          clock: { now: () => new Date() },
          reconcile,
          logger: { info: vi.fn(), warn: vi.fn() },
        },
      ),
    ).toThrow("memory_projection_reconcile_batch_size_invalid");
    expect(reconcile).not.toHaveBeenCalled();
  });
});
