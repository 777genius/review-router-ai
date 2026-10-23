import type { UsageTotals } from "@reviewrouter/features-provider-usage";
export type UsageMetric = "tokens" | "requests" | "cost";
export type CostBucket = { currency: string; basis: string };
export const count = (value: number | null) =>
  value === null ? "Unknown" : value.toLocaleString("en-US");
export const compact = (value: number | null) =>
  value === null
    ? "Unknown"
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
  if (!costs.length) return "Unknown";
  if (currency && !costs.some((cost) => cost.currency === currency))
    return `No ${currency} amount`;
  return currency && basis
    ? `No ${currency} ${basisLabel(basis)} amount`
    : "Unknown";
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
  if (value === null) return "Unknown";
  return (
    count(Number(value)) +
    (metric === "tokens" && totals.unknownTotalTokenCount > 0
      ? " (known part; some total tokens unknown)"
      : "")
  );
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
export const observedLabel = (models: readonly string[], unknown: boolean) =>
  [...models, ...(unknown ? ["Unknown"] : [])].join(", ") || "Unknown";
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
