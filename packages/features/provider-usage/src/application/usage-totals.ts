import type { UsageProjection, UsageTokens } from "../domain/usage";
import { costUnits, decimal } from "./usage-money";
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
export function provenNotDispatched(p: UsageProjection): boolean {
  return (
    p.usage?.dispatchEffect === "not_dispatched" ||
    (p.lifecycle?.dispatchEffect === "not_dispatched" &&
      p.lifecycle.state !== "prepared")
  );
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
  let unknownCostCount = 0;
  const costs = new Map<
    string,
    { currency: string; basis: "estimated" | "source_reported"; units: bigint }
  >();
  for (const p of rows) {
    if (p.usage?.tokens.total == null) unknownTotalTokenCount++;
    if (p.usage?.completeness === "partial") partialCount++;
    if (!p.usage || p.usage.completeness === "unknown") unknownCount++;
    if (p.identity.purpose === "diagnostic") diagnosticCount++;
    for (const k of tokenKeys) {
      const n = p.usage?.tokens[k] ?? null;
      if (n === null) unknownTokenValues++;
      else {
        const sum = (tokens[k] ?? 0) + n;
        if (!Number.isSafeInteger(sum))
          throw new Error("usage_report_overflow");
        tokens[k] = sum;
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
        p.identity.granularity === "call" &&
        !provenNotDispatched(p) &&
        ((p.lifecycle?.dispatchEffect === "dispatched" &&
          p.lifecycle.state !== "prepared") ||
          (p.usage !== null &&
            p.usage.dispatchEffect !== "not_dispatched" &&
            p.usage.state !== "prepared")),
    ).length,
    logicalRuns: new Set(
      attemptRows
        .map((p) => p.identity.runId)
        .filter((id): id is string => id !== null),
    ).size,
    reportedSummaries: rows.filter((p) => p.identity.granularity === "turn")
      .length,
    costs: [...costs.values()].map((c) => ({
      currency: c.currency,
      basis: c.basis,
      amount: decimal(c.units),
    })),
  };
}
