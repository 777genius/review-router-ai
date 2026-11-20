import { isOpenRouterFreeVariant } from "@reviewrouter/features-review-providers";

/**
 * A reviewer as an editor holds it. `provider` is its connection's provider,
 * unknown while the account is still loading.
 */
export type RosterReviewerModel = Readonly<{
  provider: string | undefined;
  model: string;
}>;

/** The reviewer's model stops for the day once its daily request limit is used up. */
export function hasDailyRequestLimit(reviewer: RosterReviewerModel): boolean {
  return isOpenRouterFreeVariant(reviewer.provider, reviewer.model);
}

/**
 * A run skips a reviewer stopped by its quota only when another reviewer
 * finished (plan 69), so a roster whose only reviewer has a daily limit stops
 * reviewing until the limit resets. The notice asks for a paid model or
 * another provider, because OpenRouter counts every `:free` request of an
 * account against one limit; any second reviewer hides it (owner rule).
 */
export function soleReviewerHasDailyLimit(
  reviewers: readonly RosterReviewerModel[],
): boolean {
  return reviewers.length === 1 && hasDailyRequestLimit(reviewers[0]!);
}
