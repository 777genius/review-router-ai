import type { UsageProjection, UsageTokens } from "../domain/usage";
import type { UsageReportQuery } from "./ports";
import type { UsagePeriodReport } from "./report-usage";
import { costUnits, decimal } from "./usage-money";
import {
  buildUsageTopModels,
  compareUsageStrings,
  usageRequestedIdentityKey,
  type UsageModelAggregate,
  type UsageRequestedIdentity,
} from "./usage-overview";
import {
  aggregateUsage,
  checkedUsageInteger,
  type UsageCostSubtotal,
  type UsageTotals,
} from "./usage-totals";

/** Exact storage arithmetic; SQL has already applied application contribution flags. */
export type UsageAggregateTotals = {
  tokens: { [K in keyof UsageTokens]: string | null };
  costs: UsageCostSubtotal[];
} & {
  [K in Exclude<keyof UsageTotals, "tokens" | "costs">]: string;
};
export interface UsageReportAggregateBucket {
  kind: "totals" | "groups" | "daily" | "modelRoute" | "modelRank" | "run";
  provider: string | null;
  model: string | null;
  route: "gateway" | "direct" | null;
  day: string | null;
  runId: string | null;
  totals: UsageAggregateTotals;
  observedModels: string[];
  hasUnknownObservedModel: boolean;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  identities: UsageRequestedIdentity[];
  routes: ("gateway" | "direct")[];
}
export interface UsageReportAggregateInput {
  query: UsageReportQuery;
  buckets: readonly UsageReportAggregateBucket[];
  facets: readonly UsageRequestedIdentity[];
  rows: readonly UsageProjection[];
  nextCursor: string | null;
  nextRunCursor: string | null;
  partialChildCount: number;
  unboundedSummaryCount: number;
  hasDirectObservations: boolean;
  observationsWithoutRunId: number;
}

export function finalizeUsageTotals(raw: UsageAggregateTotals): UsageTotals {
  const token = (key: keyof UsageTokens) =>
    raw.tokens[key] === null ? null : checkedUsageInteger(raw.tokens[key]);
  return {
    tokens: {
      inputTotal: token("inputTotal"),
      outputTotal: token("outputTotal"),
      cacheRead: token("cacheRead"),
      cacheWrite: token("cacheWrite"),
      reasoning: token("reasoning"),
      total: token("total"),
    },
    unknownTokenValues: checkedUsageInteger(raw.unknownTokenValues),
    unknownTotalTokenCount: checkedUsageInteger(raw.unknownTotalTokenCount),
    partialCount: checkedUsageInteger(raw.partialCount),
    unknownCount: checkedUsageInteger(raw.unknownCount),
    providerAttempts: checkedUsageInteger(raw.providerAttempts),
    logicalRuns: checkedUsageInteger(raw.logicalRuns),
    reportedSummaries: checkedUsageInteger(raw.reportedSummaries),
    diagnosticCount: checkedUsageInteger(raw.diagnosticCount),
    unknownCostCount: checkedUsageInteger(raw.unknownCostCount),
    costs: raw.costs.map((cost) => ({
      ...cost,
      amount: decimal(costUnits(cost.amount)),
    })),
  };
}
function required<T>(value: T | null): T {
  if (value === null) throw new Error("usage_invalid_report_aggregate");
  return value;
}
const annotations = (bucket: UsageReportAggregateBucket) => ({
  observedModels: [...new Set(bucket.observedModels)].sort(compareUsageStrings),
  hasUnknownObservedModel: bucket.hasUnknownObservedModel,
});
const requestedIdentity = (bucket: UsageReportAggregateBucket) => ({
  provider: required(bucket.provider),
  requestedModel: bucket.model,
});
function sortedIdentities(identities: readonly UsageRequestedIdentity[]) {
  return [
    ...new Map(
      identities.map((identity) => [
        usageRequestedIdentityKey(identity),
        identity,
      ]),
    ).values(),
  ].sort((a, b) =>
    compareUsageStrings(
      usageRequestedIdentityKey(a),
      usageRequestedIdentityKey(b),
    ),
  );
}

/** Assemble bounded pages and full-period aggregates without recreating source facts. */
export function buildUsagePeriodReportFromAggregates(
  input: UsageReportAggregateInput,
): UsagePeriodReport {
  const ofKind = (kind: UsageReportAggregateBucket["kind"]) =>
    input.buckets.filter((bucket) => bucket.kind === kind);
  const model = (bucket: UsageReportAggregateBucket): UsageModelAggregate => ({
    ...requestedIdentity(bucket),
    totals: finalizeUsageTotals(bucket.totals),
    ...annotations(bucket),
  });
  const aggregateModels = ofKind("modelRank").map(model);
  const total = ofKind("totals")[0];
  const facets = sortedIdentities(input.facets);
  return {
    from: input.query.from.toISOString(),
    to: input.query.to.toISOString(),
    timezone: "UTC",
    totals: total ? finalizeUsageTotals(total.totals) : aggregateUsage([]),
    // The reader supplies legacy groups in native first-selected occurrence order.
    groups: ofKind("groups").map((bucket) => ({
      provider: required(bucket.provider),
      model: bucket.model,
      day: required(bucket.day),
      totals: finalizeUsageTotals(bucket.totals),
    })),
    rows: [...input.rows].sort((a, b) =>
      compareUsageStrings(a.identity.callId, b.identity.callId),
    ),
    nextCursor: input.nextCursor,
    partialChildCount: input.partialChildCount,
    unboundedSummaryCount: input.unboundedSummaryCount,
    unattributedCount: null,
    deliveryCoverage: [],
    sources: [],
    overview: {
      daily: ofKind("daily")
        .sort((a, b) =>
          compareUsageStrings(
            JSON.stringify([a.day, a.provider]),
            JSON.stringify([b.day, b.provider]),
          ),
        )
        .map((bucket) => ({
          day: required(bucket.day),
          provider: required(bucket.provider),
          totals: finalizeUsageTotals(bucket.totals),
        })),
      models: ofKind("modelRoute")
        .sort((a, b) =>
          compareUsageStrings(
            JSON.stringify([a.provider, a.model, a.route]),
            JSON.stringify([b.provider, b.model, b.route]),
          ),
        )
        .map((bucket) => ({ ...model(bucket), route: required(bucket.route) })),
      topModels: buildUsageTopModels(aggregateModels),
      runs: ofKind("run")
        .sort((a, b) =>
          compareUsageStrings(required(a.runId), required(b.runId)),
        )
        .map((bucket) => ({
          runId: required(bucket.runId),
          firstOccurredAt: required(bucket.firstOccurredAt),
          lastOccurredAt: required(bucket.lastOccurredAt),
          identities: sortedIdentities(bucket.identities),
          ...annotations(bucket),
          routes: [...new Set(bucket.routes)].sort(compareUsageStrings),
          totals: finalizeUsageTotals(bucket.totals),
        })),
      nextRunCursor: input.nextRunCursor,
      facets: {
        providers: [
          ...new Set(facets.map((identity) => identity.provider)),
        ].sort(compareUsageStrings),
        models: facets,
      },
      hasDirectObservations: input.hasDirectObservations,
      observationsWithoutRunId: input.observationsWithoutRunId,
    },
  };
}
