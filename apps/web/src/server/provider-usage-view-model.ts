import type {
  UsagePeriodReport,
  UsageTotals,
} from "@reviewrouter/features-provider-usage";
export interface UsageFilters {
  from?: string | undefined;
  to?: string | undefined;
  route?: "gateway" | "direct" | undefined;
  purpose?: "review" | "diagnostic" | undefined;
  bindingId?: string | undefined;
  runId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  runAfter?: string | undefined;
  after?: string | undefined;
}
export interface UsageReportRow {
  id: string;
  provider: string;
  requestedProvider?: string;
  actualProvider?: string | null;
  requestedModel?: string | null;
  actualModel?: string | null;
  model: string | null;
  day: string;
  route: string;
  purpose: string;
  runId: string | null;
  granularity: string;
  total: number | null;
  completeness: string;
  cost: { amount: string; currency: string; basis: string } | null;
  authority: string | null;
  durationMs: number | null;
  ttftMs: number | null;
}
export interface ProviderUsageReport {
  overview: UsagePeriodReport["overview"];
  totals: UsageTotals;
  deliveryCoverage: UsagePeriodReport["deliveryCoverage"];
  groups: UsagePeriodReport["groups"];
  nextCursor: string | null;
  from: string;
  to: string;
  asOf: string | null;
  sources: UsagePeriodReport["sources"];
  unattributed: number | null;
  coveredFrom: string | null;
  sourceLag: string;
  rows: UsageReportRow[];
  attempts: number;
  logicalRuns: number;
  unknown: number;
  partial: number;
  unboundedSummaries: number;
  hasMore: boolean;
}
/** Browser DTO deliberately excludes authorization IDs, source credentials and account labels. */
export function buildUsageReport(
  report: UsagePeriodReport,
): ProviderUsageReport {
  const rows = report.rows.map((p) => ({
    id: p.identity.callId,
    provider: p.usage?.actualProvider ?? p.identity.provider,
    requestedProvider: p.identity.provider,
    actualProvider: p.usage?.actualProvider ?? null,
    requestedModel: p.identity.requestedModel,
    actualModel: p.usage?.actualModel ?? null,
    model: p.usage?.actualModel ?? p.identity.requestedModel,
    day: p.identity.occurredAt.slice(0, 10),
    route: p.identity.route,
    purpose: p.identity.purpose,
    runId: p.identity.runId,
    granularity: p.identity.granularity,
    total: p.usage?.tokens.total ?? null,
    completeness: p.usage?.completeness ?? "unknown",
    cost: p.usage?.cost
      ? {
          amount: p.usage.cost.amount,
          currency: p.usage.cost.currency,
          basis: p.usage.cost.basis,
        }
      : null,
    authority: p.usage?.authority ?? null,
    durationMs: p.usage?.durationMs ?? p.lifecycle?.durationMs ?? null,
    ttftMs: p.usage?.ttftMs ?? null,
  }));
  return {
    overview: report.overview,
    from: report.from,
    to: report.to,
    asOf:
      report.sources.length && report.sources.every((s) => s.asOf !== null)
        ? report.sources.reduce(
            (a, s) => (s.asOf! < a ? s.asOf! : a),
            report.sources[0]!.asOf!,
          )
        : null,
    sources: report.sources,
    unattributed: report.unattributedCount,
    coveredFrom: report.sources.length
      ? report.sources.reduce(
          (a, s) => (s.coveredFrom > a ? s.coveredFrom : a),
          report.sources[0]!.coveredFrom,
        )
      : null,
    sourceLag:
      report.sources.length && report.sources.every((s) => s.lagMs !== null)
        ? `${Math.max(...report.sources.map((s) => s.lagMs!)) / 1000}s (native reconciliation)`
        : "unknown",
    rows,
    totals: report.totals,
    deliveryCoverage: report.deliveryCoverage,
    groups: report.groups,
    nextCursor: report.nextCursor,
    attempts: report.totals.providerAttempts,
    logicalRuns: report.totals.logicalRuns,
    unknown: report.totals.unknownCount,
    partial: report.totals.partialCount,
    unboundedSummaries: report.unboundedSummaryCount,
    hasMore: report.nextCursor !== null,
  };
}
