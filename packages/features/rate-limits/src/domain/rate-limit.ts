export type RateLimitRule = {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Weighted units reserved by this operation; ordinary requests cost one. */
  readonly amount?: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly key: string;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;
};

export class RateLimitExceededError extends Error {
  constructor(readonly decision: RateLimitDecision) {
    super(`rate_limit_exceeded:${decision.key}`);
    this.name = "RateLimitExceededError";
  }
}

export function normalizeRateLimitRule(rule: RateLimitRule): RateLimitRule {
  const key = rule.key.trim();
  if (!key) {
    throw new Error("rate_limit_key_required");
  }
  if (
    !Number.isInteger(rule.limit) ||
    rule.limit <= 0 ||
    rule.limit > 2_147_483_646
  ) {
    throw new Error("rate_limit_limit_invalid");
  }
  if (!Number.isInteger(rule.windowMs) || rule.windowMs <= 0) {
    throw new Error("rate_limit_window_invalid");
  }
  if (
    rule.amount !== undefined &&
    (!Number.isInteger(rule.amount) ||
      rule.amount <= 0 ||
      rule.amount > 2_147_483_646)
  )
    throw new Error("rate_limit_amount_invalid");
  return {
    key,
    limit: rule.limit,
    windowMs: rule.windowMs,
    ...(rule.amount === undefined ? {} : { amount: rule.amount }),
  };
}

export function rateLimitRetryAfterSeconds(
  decision: RateLimitDecision,
  now: Date,
): number {
  return Math.max(
    1,
    Math.ceil((decision.resetAt.getTime() - now.getTime()) / 1000),
  );
}

export function createFixedWindow(input: {
  readonly now: Date;
  readonly windowMs: number;
}): { readonly windowStart: Date; readonly windowEndsAt: Date } {
  const windowStartMs =
    Math.floor(input.now.getTime() / input.windowMs) * input.windowMs;
  const windowStart = new Date(windowStartMs);
  return {
    windowStart,
    windowEndsAt: new Date(windowStartMs + input.windowMs),
  };
}

export function createRateLimitDecision(input: {
  readonly key: string;
  readonly limit: number;
  readonly count: number;
  readonly resetAt: Date;
}): RateLimitDecision {
  const allowed = input.count <= input.limit;
  return {
    allowed,
    key: input.key,
    limit: input.limit,
    remaining: Math.max(input.limit - input.count, 0),
    resetAt: input.resetAt,
  };
}
