import type { UsageProjection, UsageTokens } from "../domain/usage";
import { costUnits, decimal } from "./usage-money";
import {
  classifyUsageContribution,
  usageContributionProfile,
} from "./usage-contribution";
export { provenNotDispatched } from "./usage-contribution";
export interface UsageCostSubtotal {
  currency: string;
  basis: "estimated" | "source_reported";
  amount: string;
}
export interface UsageTotals {
  tokens: UsageTokens;
  unknownTokenValues: number;
  /** Selected observations missing tokens.total; optional token subsets do not affect this count. */
  unknownTotalTokenCount: number;
  partialCount: number;
  unknownCount: number;
  providerAttempts: number;
  logicalRuns: number;
  reportedSummaries: number;
  diagnosticCount: number;
  costs: UsageCostSubtotal[];
  unknownCostCount: number;
}
/** SQL integer sums arrive as text so precision is checked before DTO conversion. */
export function checkedUsageInteger(value: number | string): number {
  const n = Number(value);
  if (
    (typeof value === "string" && !/^-?\d+$/.test(value)) ||
    !Number.isSafeInteger(n)
  )
    throw new Error("usage_report_overflow");
  return n;
}
const tokenKeys = [
  "inputTotal",
  "outputTotal",
  "cacheRead",
  "cacheWrite",
  "reasoning",
  "total",
] as const;
export function aggregateUsage(
  rows: readonly UsageProjection[],
  attemptRows: readonly UsageProjection[] = rows,
): UsageTotals {
  const tokens: UsageTokens = {
    inputTotal: null,
    outputTotal: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    total: null,
  };
  let unknownTokenValues = 0;
  let unknownTotalTokenCount = 0;
  let partialCount = 0;
  let unknownCount = 0;
  let diagnosticCount = 0;
  let reportedSummaries = 0;
  let unknownCostCount = 0;
  const costs = new Map<
    string,
    { currency: string; basis: "estimated" | "source_reported"; units: bigint }
  >();
  for (const p of rows) {
    // Callers own spend selection; this public helper sums every supplied row.
    const contribution = classifyUsageContribution(usageContributionProfile(p));
    if (p.usage?.tokens.total == null) unknownTotalTokenCount++;
    partialCount += contribution.partialWeight;
    unknownCount += contribution.unknownWeight;
    diagnosticCount += contribution.diagnosticWeight;
    reportedSummaries += contribution.summaryWeight;
    for (const k of tokenKeys) {
      const n = p.usage?.tokens[k] ?? null;
      if (n === null) unknownTokenValues++;
      else {
        tokens[k] = checkedUsageInteger((tokens[k] ?? 0) + n);
      }
    }
    const cost = p.usage?.cost;
    if (!cost) {
      unknownCostCount++;
      continue;
    }
    const key = cost.currency + ":" + cost.basis;
    const old = costs.get(key);
    costs.set(key, {
      currency: cost.currency,
      basis: cost.basis,
      units: (old?.units ?? 0n) + costUnits(cost.amount),
    });
  }
  return {
    tokens,
    unknownTokenValues,
    unknownTotalTokenCount,
    partialCount,
    unknownCount,
    diagnosticCount,
    unknownCostCount,
    providerAttempts: attemptRows.filter(
      (p) =>
        classifyUsageContribution(usageContributionProfile(p)).providerAttempt,
    ).length,
    logicalRuns: new Set(
      attemptRows
        .map((p) => p.identity.runId)
        .filter((id): id is string => id !== null),
    ).size,
    reportedSummaries,
    costs: [...costs.values()].map((c) => ({
      currency: c.currency,
      basis: c.basis,
      amount: decimal(c.units),
    })),
  };
}
