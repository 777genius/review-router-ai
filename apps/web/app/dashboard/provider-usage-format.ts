import type { UsageTotals } from "@reviewrouter/features-provider-usage";
import type { ProviderUsageReport } from "./provider-usage-model";
export type UsageMetric = "tokens" | "requests" | "cost";
export type CostBucket = { currency: string; basis: string };
/** A source omitted the value; the UI must not present it as measured. */
export const NOT_REPORTED = "Not reported";
/** A null aggregate means no call in the bucket reported this value. */
export const count = (value: number | null) =>
  value === null ? NOT_REPORTED : value.toLocaleString("en-US");
export const compact = (value: number | null) =>
  value === null
    ? NOT_REPORTED
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value);
/** Keep positive sub-cent tick values distinguishable from a measured zero. */
export const costAxisLabel = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 3,
    notation:
      Math.abs(value) >= 1000
        ? "compact"
        : value !== 0 && Math.abs(value) < 0.001
          ? "scientific"
          : "standard",
  }).format(value);
export const basisLabel = (basis: string) =>
  basis === "source_reported" ? "source reported" : basis;
export const costKey = (cost: CostBucket) =>
  JSON.stringify([cost.currency, cost.basis]);
export const costLabel = (cost: CostBucket & { amount: string }) =>
  `${cost.amount} ${cost.currency} (${basisLabel(cost.basis)})`;
export function currencyCostsLabel(
  costs: readonly (CostBucket & { amount: string })[],
  currency?: string,
  basis?: string,
): string {
  const selected = selectedCosts(costs, currency, basis);
  if (selected.length) return selected.map(costLabel).join(" · ");
  if (!costs.length) return NOT_REPORTED;
  if (currency && !costs.some((cost) => cost.currency === currency))
    return `No ${currency} amount`;
  return currency && basis
    ? `No ${currency} ${basisLabel(basis)} amount`
    : NOT_REPORTED;
}
export const costsLabel = (
  totals: UsageTotals,
  currency?: string,
  basis?: string,
) => currencyCostsLabel(totals.costs, currency, basis);
export function metricValue(
  totals: UsageTotals,
  metric: UsageMetric,
  bucket: CostBucket | undefined,
): string | number | null {
  if (metric === "tokens") return totals.tokens.total;
  if (metric === "requests") return totals.providerAttempts;
  return (
    totals.costs.find((c) => bucket && costKey(c) === costKey(bucket))
      ?.amount ?? null
  );
}
export function metricLabel(
  totals: UsageTotals,
  metric: UsageMetric,
  bucket: CostBucket | undefined,
): string {
  const value = metricValue(totals, metric, bucket);
  if (metric === "cost" && bucket)
    return costsLabel(totals, bucket.currency, bucket.basis);
  if (value === null) return NOT_REPORTED;
  // Calls without a token total only add to the real total, so the sum of the
  // reported ones is a lower bound.
  return (
    (metric === "tokens" && totals.unknownTotalTokenCount > 0
      ? "at least "
      : "") + count(Number(value))
  );
}
const calls = (value: number) =>
  `${count(value)} ${value === 1 ? "call" : "calls"}`;
/*
 * The plain words for usage gaps. Everything below is the one source of this
 * wording for the tooltip, table, legend, KPI, coverage, notes and Details.
 */
const tokensGap = {
  one: "may not have reported all its tokens",
  many: "may not have reported all their tokens",
};
const costGap = {
  one: "did not report its cost",
  many: "did not report their cost",
};
/** "1 call did ... its ..." / "2 calls did ... their ...". */
const callsThat = (value: number, gap: { one: string; many: string }) =>
  `${calls(value)} ${value === 1 ? gap.one : gap.many}`;
/** Short notes for one bucket, e.g. a chart tooltip row. */
export const SOME_TOKENS_NOT_REPORTED = `some calls ${tokensGap.many}`;
export const SOME_COST_NOT_REPORTED = `some calls ${costGap.many}`;
/** Why a token count reads "at least N". */
export const TOKEN_LOWER_BOUND_NOTE =
  "Some calls did not report a token total, so the real total may be higher";
/** The same, under a token total that is a lower bound. */
export const TOKEN_LOWER_BOUND_HINT = `At least this many. ${TOKEN_LOWER_BOUND_NOTE}`;
/** A day only partly inside the period (see `partialDayLabel`). */
export const PARTIAL_DAY_NOTE =
  "The first and last day may cover only part of the day"; the last one shows usage so far";
/**
 * One readable status per bucket. Source completeness flags are mutually
 * exclusive per call, so their sum is an exact count of incomplete calls.
 */
export function tokenCoverage(
  totals: Pick<
    UsageTotals,
    "unknownCount" | "partialCount" | "unknownTotalTokenCount"
  >,
): {
  label: string;
  detail: string | undefined;
  incomplete: boolean;
  /** Under a token total that is only a lower bound. */
  totalHint?: string;
} {
  const incomplete = totals.unknownCount + totals.partialCount;
  if (!incomplete && !totals.unknownTotalTokenCount)
    return {
      label: "Every recorded call reported its tokens",
      detail: undefined,
      incomplete: false,
    };
  const withoutTotal = `${calls(totals.unknownTotalTokenCount)} did not report a token total`;
  return {
    label: incomplete ? callsThat(incomplete, tokensGap) : withoutTotal,
    detail: [
      totals.unknownCount
        ? `${calls(totals.unknownCount)} reported no tokens`
        : "",
      totals.partialCount
        ? callsThat(totals.partialCount, {
            one: "may have reported only part of its tokens",
            many: "may have reported only part of their tokens",
          })
        : "",
      totals.unknownTotalTokenCount ? withoutTotal : "",
    ]
      .filter(Boolean)
      .join(" · "),
    incomplete: true,
    ...(totals.unknownTotalTokenCount
      ? { totalHint: TOKEN_LOWER_BOUND_HINT }
      : {}),
  };
}
export const missingCostLabel = (unknownCostCount: number) =>
  `Excludes ${calls(unknownCostCount)} without cost`;
type RequestedIdentity = {
  provider: string;
  requestedModel: string | null | undefined;
};
/**
 * A cost fact provable from a requested identity: OpenRouter bills its
 * `:free` variants at zero, and ReviewRouter never sends paid fallback models.
 */
export const isFreeModel = (identity: RequestedIdentity) =>
  identity.provider === "openrouter" &&
  (identity.requestedModel?.endsWith(":free") ?? false);
/** Why calls carry no cost: a free model, or a flat subscription/coding plan. */
export type UsagePricing = "free_model" | "subscription" | undefined;
/**
 * A bucket is free or subscription-priced only when every requested identity in
 * it is. Subscription pricing is proven only on the Gateway route, where the
 * profile names its plan (`subscriptionProviders` comes from the report).
 */
export function usagePricing(
  identities: readonly RequestedIdentity[],
  routes: readonly string[],
  subscriptionProviders: readonly string[],
): UsagePricing {
  if (!identities.length) return undefined;
  if (identities.every(isFreeModel)) return "free_model";
  return routes.length > 0 &&
    routes.every((route) => route === "gateway") &&
    identities.every(({ provider }) => subscriptionProviders.includes(provider))
    ? "subscription"
    : undefined;
}
/**
 * Footer note naming each measurement the source left out, in the same words
 * as the rows. A cost explained by a free model or a subscription plan is not
 * missing, so it never reads as lost data.
 */
export function unreportedUsageNote(
  report: Pick<ProviderUsageReport, "totals" | "subscriptionProviders"> & {
    overview: Pick<ProviderUsageReport["overview"], "models">;
  },
): string | null {
  const tokens = tokenCoverage(report.totals);
  const withoutCost = report.overview.models.reduce(
    (sum, model) =>
      usagePricing([model], [model.route], report.subscriptionProviders)
        ? sum
        : sum + model.totals.unknownCostCount,
    0,
  );
  const parts = [
    tokens.incomplete ? tokens.label : "",
    withoutCost ? callsThat(withoutCost, costGap) : "",
  ].filter(Boolean);
  return parts.length ? `△ ${parts.join(" · ")}` : null;
}
export function observedPair(
  provider: string | null | undefined,
  model: string | null | undefined,
): string {
  return provider || model
    ? `${provider ?? NOT_REPORTED} / ${model ?? NOT_REPORTED}`
    : NOT_REPORTED;
}
export function latencyLabel(
  durationMs: number | null,
  ttftMs: number | null,
): string {
  const ms = (value: number | null) =>
    value === null ? NOT_REPORTED : `${count(value)} ms`;
  return durationMs === null && ttftMs === null
    ? NOT_REPORTED
    : `${ms(durationMs)} / ${ms(ttftMs)}`;
}
export function chartNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function providerColor(provider: string): string {
  const name = provider.toLowerCase();
  if (/unknown|unavailable/.test(name)) return "var(--rr-chart-neutral)";
  if (/codex|openai/.test(name)) return "var(--rr-chart-cyan)";
  if (/mimo/.test(name)) return "var(--rr-chart-purple)";
  if (/openrouter/.test(name)) return "var(--rr-chart-green)";
  const hash = [...provider].reduce(
    (n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0,
    0,
  );
  return [
    "var(--rr-chart-cyan)",
    "var(--rr-chart-purple)",
    "var(--rr-chart-green)",
    "var(--rr-chart-amber)",
    "var(--rr-chart-pink)",
  ][hash % 5]!;
}
export const requestedModelLabel = (value: string | null) =>
  value ?? "Unknown requested model";
/** Observed upstream models; calls whose source omitted the model are labelled. */
export const observedValues = (models: readonly string[], unknown: boolean) => [
  ...models,
  ...(unknown ? [NOT_REPORTED] : []),
];
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(day));
const DAY = 86_400_000;
export function rollingInterval(days: 7 | 30 | 90, now = new Date()) {
  return {
    from: new Date(now.getTime() - days * DAY).toISOString(),
    to: now.toISOString(),
  };
}
export function customInterval(
  from: string,
  through: string,
): { from: string; to: string } | { error: string } {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${through}T00:00:00.000Z`) + DAY;
  if (
    !from ||
    !through ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== from ||
    new Date(end - DAY).toISOString().slice(0, 10) !== through
  )
    return { error: "Choose valid start and end dates." };
  if (end <= start)
    return { error: "End date must be on or after start date." };
  if (end - start > 366 * DAY)
    return { error: "Choose a period of 366 days or less." };
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  };
}
/** Presentation calendar only. Values and authority remain feature-owned. */
export function utcDays(from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  const days: { day: string; partial: boolean }[] = [];
  for (
    let value = Math.floor(start / DAY) * DAY;
    value < end && days.length < 367;
    value += DAY
  )
    days.push({
      day: new Date(value).toISOString().slice(0, 10),
      partial: value < start || value + DAY > end,
    });
  return days;
}

export function intervalLabel(
  from: string | undefined,
  to: string | undefined,
): string {
  if (!from || !to) return "Selected UTC period";
  const dates = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  // Node and browsers can use different ICU spacing for the same UTC range.
  const range = dates
    .formatRange(new Date(from), new Date(Date.parse(to) - 1))
    .replace(/\s+/gu, " ");
  return `${range} UTC`;
}

export const valuationLabel = (basis: string) =>
  basis === "source_reported" ? "Reported" : "Estimated";
export function selectedCosts<T extends CostBucket>(
  costs: readonly T[],
  currency?: string,
  basis?: string,
): T[] {
  return costs.filter(
    (cost) =>
      (!currency || cost.currency === currency) &&
      (!basis || cost.basis === basis),
  );
}
export const shortIdentity = (value: string, limit = 28) =>
  value.length > limit
    ? `${value.slice(0, limit - 9)}…${value.slice(-8)}`
    : value;
const utcParts = (value: string) => {
  const date = new Date(value);
  return {
    day: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
    time: `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`,
  };
};
export function humanUtc(value: string): string {
  const date = utcParts(value);
  return `${date.day}, ${date.time} UTC`;
}
export function humanUtcRange(first: string, last: string): string {
  const start = utcParts(first),
    end = utcParts(last);
  if (first === last) return `${start.day}, ${start.time} UTC`;
  return start.day === end.day
    ? `${start.day}, ${start.time} - ${end.time} UTC`
    : `${start.day}, ${start.time} - ${end.day}, ${end.time} UTC`;
}

/**
 * Plain words for a UTC day only partly inside the period: the last day counts
 * usage so far, and the first day of a rolling period starts mid-day. Taken
 * from the period alone, so server and browser render the same words.
 */
export function partialDayLabel(
  day: { day: string; partial: boolean },
  period: { from: string; to: string },
): string | null {
  if (!day.partial) return null;
  const end = new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10);
  return day.day === end
    ? `so far, until ${utcParts(period.to).time} UTC`
    : `from ${utcParts(period.from).time} UTC`;
}
