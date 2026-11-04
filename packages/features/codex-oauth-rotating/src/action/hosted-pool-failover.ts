/** Pure bounded failover policy, separate from Action transport and orchestration. */
import { remainingReviewExecutionBudgetMs } from "../domain/review-execution-budget";

const hostedPoolMaxLeaseAttempts = 2;
const hostedPoolMinimumRetryBudgetMs = 90_000;

export type HostedPoolFailureReason =
  | "quota_exhausted"
  | "authentication_failed"
  | undefined;

export type HostedPoolFailoverInput<T> = {
  readonly maxAttempts?: number | undefined;
  readonly canRetry: () => boolean;
  readonly runAttempt: (input: {
    readonly attempt: number;
    readonly maxAttempts: number;
  }) => Promise<T>;
  readonly onRetry?:
    | ((input: {
        readonly attempt: number;
        readonly maxAttempts: number;
        readonly reason: Exclude<HostedPoolFailureReason, undefined>;
      }) => void | Promise<void>)
    | undefined;
};

export function hasHostedPoolRetryBudget(input: {
  readonly executionDeadlineEpochMs: number;
  readonly nowEpochMs: number;
}): boolean {
  return (
    remainingReviewExecutionBudgetMs(input) >= hostedPoolMinimumRetryBudgetMs
  );
}

export async function runHostedPoolLeaseFailover<T>(
  input: HostedPoolFailoverInput<T>,
): Promise<T> {
  const maxAttempts = input.maxAttempts ?? hostedPoolMaxLeaseAttempts;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > hostedPoolMaxLeaseAttempts
  ) {
    throw new Error("hosted_pool_retry_budget_invalid");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.runAttempt({ attempt, maxAttempts });
    } catch (error) {
      const reason = hostedPoolAccountFailureReason(error);
      if (!reason) throw error;
      lastError = error;
      if (attempt === maxAttempts || !input.canRetry()) {
        throw new Error("hosted_pool_capacity_exhausted", { cause: error });
      }
      await input.onRetry?.({ attempt, maxAttempts, reason });
    }
  }
  throw new Error("hosted_pool_capacity_exhausted", { cause: lastError });
}

export function hostedPoolAccountFailureReason(
  error: unknown,
): HostedPoolFailureReason {
  const normalized = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  if (isHostedPoolQuotaFailureText(normalized)) {
    return "quota_exhausted";
  }
  if (
    normalized === "hosted_pool_authentication_failed" ||
    normalized === "hosted_relay_grant_failed:401"
  ) {
    return "authentication_failed";
  }
  return undefined;
}

export function isHostedPoolQuotaFailureText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized === "hosted_pool_quota_exhausted" ||
    normalized === "hosted_relay_grant_failed:429" ||
    normalized === "quota_limited" ||
    normalized.includes("provider_capacity_limited") ||
    /exceeded retry limit, last status: 429/.test(normalized) ||
    /you(?:'|’)ve hit your usage limit/.test(normalized)
  );
}

