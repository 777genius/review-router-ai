import { describe, expect, it } from "vitest";
import { settleProviderUsageMaintenance } from "./provider-usage-maintenance";

describe("usage maintenance ownership", () => {
  it("retains ownership of another task after a failure and reports it after settlement", async () => {
    let finish!: () => void;
    let settled = false;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const result = settleProviderUsageMaintenance([
      Promise.reject(new Error("private database details")),
      pending,
    ]).finally(() => {
      settled = true;
    });
    const rejection = expect(result).rejects.toThrow(
      "provider_usage_maintenance_failed",
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await rejection;
    expect(settled).toBe(true);
  });
});
