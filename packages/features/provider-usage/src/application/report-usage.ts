import { selectReportFacts, type UsageProjection } from "../domain/usage";
import type { UsageReportQuery } from "./ports";
import {
  aggregateUsage,
  provenNotDispatched,
  type UsageTotals,
} from "./usage-totals";
export { aggregateUsage } from "./usage-totals";
export type { UsageTotals, UsageCostSubtotal } from "./usage-totals";
import { buildUsageOverview, type UsageOverview } from "./usage-overview";
export type {
  UsageOverview,
  UsageModelAggregate,
  UsageRequestedIdentity,
} from "./usage-overview";
export interface UsagePeriodReport {
  overview: UsageOverview;
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
/** Call only with the complete authorized, filtered period, never a page. */
export function buildUsagePeriodReport(
  projections: readonly UsageProjection[],
  query: UsageReportQuery,
): UsagePeriodReport {
  const selection = selectReportFacts(projections);
  const matchesDimensions = (p: UsageProjection) =>
    (query.provider === undefined || p.identity.provider === query.provider) &&
    (query.model === undefined || p.identity.requestedModel === query.model);
  const selected = selection.selected.filter(
    (p) => !provenNotDispatched(p) && matchesDimensions(p),
  );
  const attempts = projections.filter(matchesDimensions);
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
    overview: buildUsageOverview(projections, selected, attempts, query),
    unattributedCount: null,
    deliveryCoverage: [],
    sources: [],
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    timezone: "UTC",
    totals: aggregateUsage(selected, attempts),
    groups: [...groups.values()].map((g) => ({
      provider: g.provider,
      model: g.model,
      day: g.day,
      totals: aggregateUsage(g.rows),
    })),
    rows: page,
    nextCursor:
      after.length > page.length ? page.at(-1)!.identity.callId : null,
    partialChildCount:
      selection.partialChildren.filter(matchesDimensions).length,
    unboundedSummaryCount:
      selection.unboundedSummaries.filter(matchesDimensions).length,
  };
}
