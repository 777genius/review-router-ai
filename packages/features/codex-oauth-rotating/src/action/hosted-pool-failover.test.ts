import { describe, expect, it, vi } from "vitest";
import {
  hasHostedPoolRetryBudget,
  hostedPoolAccountFailureReason,
  isHostedPoolQuotaFailureText,
  runHostedPoolLeaseFailover,
} from "./hosted-pool-failover";

describe("Action hosted pool failover boundary", () => {
  it("retries only an eligible quota failure and returns the next attempt", async () => {
    const runAttempt = vi.fn(async ({ attempt }: { attempt: number }) => {
      if (attempt === 1) throw new Error("hosted_pool_quota_exhausted");
      return "second-account";
    });
    const onRetry = vi.fn();
    await expect(
      runHostedPoolLeaseFailover({
        canRetry: () => true,
        runAttempt,
        onRetry,
      }),
    ).resolves.toBe("second-account");
    expect(runAttempt).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      maxAttempts: 2,
      reason: "quota_exhausted",
    });
  });

  it("does not retry an unrelated error", async () => {
    const error = new Error("permission_denied");
    const runAttempt = vi.fn(async (): Promise<void> => {
      throw error;
    });
    await expect(
      runHostedPoolLeaseFailover({
        canRetry: () => true,
        runAttempt,
      }),
    ).rejects.toBe(error);
    expect(runAttempt).toHaveBeenCalledOnce();
  });

  it("keeps failed capacity bounded and preserves the underlying cause", async () => {
    const error = new Error("hosted_relay_grant_failed:401");
    const runAttempt = vi.fn(async (): Promise<void> => {
      throw error;
    });
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => false,
        runAttempt,
      }),
    ).rejects.toMatchObject({
      message: "hosted_pool_capacity_exhausted",
      cause: error,
    });
    expect(runAttempt).toHaveBeenCalledOnce();
  });

  it("enforces the retry and remaining time limits", async () => {
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 3,
        canRetry: () => true,
        runAttempt: async () => "unexpected",
      }),
    ).rejects.toThrow("hosted_pool_retry_budget_invalid");

    expect(
      hasHostedPoolRetryBudget({
        executionDeadlineEpochMs: 100_000,
        nowEpochMs: 10_000,
      }),
    ).toBe(true);
    expect(
      hasHostedPoolRetryBudget({
        executionDeadlineEpochMs: 99_999,
        nowEpochMs: 10_000,
      }),
    ).toBe(false);
  });

  it("classifies only the supported quota and authentication signals", () => {
    expect(isHostedPoolQuotaFailureText("you've hit your usage limit")).toBe(true);
    expect(hostedPoolAccountFailureReason("hosted_relay_grant_failed:401")).toBe(
      "authentication_failed",
    );
    expect(hostedPoolAccountFailureReason("non_quota_failure")).toBeUndefined();
  });
});
