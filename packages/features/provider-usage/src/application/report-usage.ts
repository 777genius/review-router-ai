import {
  selectReportFacts,
  type UsageProjection,
  type UsageTokens,
} from "../domain/usage";
import type { UsageReportQuery } from "./ports";
export interface UsageCostSubtotal {
  currency: string;
  basis: "estimated" | "source_reported";
  amount: string;
}
export interface UsageTotals {
  tokens: UsageTokens;
  unknownTokenValues: number;
  partialCount: number;
  unknownCount: number;
  providerAttempts: number;
  logicalRuns: number;
  reportedSummaries: number;
  diagnosticCount: number;
  costs: UsageCostSubtotal[];
  unknownCostCount: number;
}
export interface UsagePeriodReport {
  unattributedCount: number | null;
  deliveryCoverage: {
    invocationId: string;
    coverage: {
      schemaVersion: 1;
      revision: number;
      state: "partial";
      reason:
        | "spool_overflow"
        | "spool_write_failed"
        | "delivery_failed"
        | "producer_unavailable";
      droppedEvents: number;
      occurredAt: string;
    } | null;
  }[];
  from: string;
  to: string;
  timezone: "UTC";
  totals: UsageTotals;
  groups: {
    provider: string;
    model: string | null;
    day: string;
    totals: UsageTotals;
  }[];
  rows: UsageProjection[];
  nextCursor: string | null;
  partialChildCount: number;
  unboundedSummaryCount: number;
  sources: {
    sourceInstance: string;
    coveredFrom: string;
    asOf: string | null;
    lagMs: number | null;
    failureCount?: number;
    nextAttemptAt?: string | null;
    deadLetteredAt?: string | null;
    lastErrorCode?: string | null;
  }[];
}
const tokenKeys = [
  "inputTotal",
  "outputTotal",
  "cacheRead",
  "cacheWrite",
  "reasoning",
  "total",
] as const;
function costUnits(amount: string): bigint {
  const [integer, fraction = ""] = amount.split(".");
  return BigInt(integer!) * 1000000000000n + BigInt(fraction.padEnd(12, "0"));
}
function decimal(units: bigint): string {
  const i = units / 1000000000000n;
  const f = (units % 1000000000000n)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return f ? `${i}.${f}` : i.toString();
}
function provenNotDispatched(p: UsageProjection): boolean {
  return (
    p.usage?.dispatchEffect === "not_dispatched" ||
    (p.lifecycle?.dispatchEffect === "not_dispatched" &&
      p.lifecycle.state !== "prepared")
  );
}
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
  let partialCount = 0;
  let unknownCount = 0;
  let diagnosticCount = 0;
  let unknownCostCount = 0;
  const costs = new Map<
    string,
    { currency: string; basis: "estimated" | "source_reported"; units: bigint }
  >();
  for (const p of rows) {
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
/** Call only with the complete authorized, filtered period, never a page. */
export function buildUsagePeriodReport(
  projections: readonly UsageProjection[],
  query: UsageReportQuery,
): UsagePeriodReport {
  const selection = selectReportFacts(projections);
  const selected = selection.selected.filter((p) => !provenNotDispatched(p));
  const groups = new Map<
    string,
    {
      provider: string;
      model: string | null;
      day: string;
      rows: UsageProjection[];
    }
  >();
  for (const p of selected) {
    const provider = p.usage?.actualProvider ?? p.identity.provider;
    const model = p.usage?.actualModel ?? null;
    const day = p.identity.occurredAt.slice(0, 10);
    const key = JSON.stringify([provider, model, day]);
    const g = groups.get(key) ?? { provider, model, day, rows: [] };
    g.rows.push(p);
    groups.set(key, g);
  }
  const sorted = [...selected].sort((a, b) =>
    a.identity.callId < b.identity.callId
      ? -1
      : a.identity.callId > b.identity.callId
        ? 1
        : 0,
  );
  const after = query.after
    ? sorted.filter((p) => p.identity.callId > query.after!)
    : sorted;
  const page = after.slice(0, query.limit ?? 100);
  return {
    unattributedCount: null,
    deliveryCoverage: [],
    sources: [],
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    timezone: "UTC",
    totals: aggregateUsage(selected, projections),
    groups: [...groups.values()].map((g) => ({
      provider: g.provider,
      model: g.model,
      day: g.day,
      totals: aggregateUsage(g.rows),
    })),
    rows: page,
    nextCursor:
      after.length > page.length ? page.at(-1)!.identity.callId : null,
    partialChildCount: selection.partialChildren.length,
    unboundedSummaryCount: selection.unboundedSummaries.length,
  };
}
