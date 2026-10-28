import { describe, it, expect } from "vitest";
import { buildUsageReport } from "../../src/server/provider-usage-view-model";
import type { UsagePeriodReport } from "@reviewrouter/features-provider-usage";
describe("safe usage browser projection", () => {
  it("preserves full-period totals even if the page is empty", () => {
    const source = {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-21T00:00:00Z",
      timezone: "UTC",
      rows: [],
      groups: [],
      overview: {
        daily: [],
        models: [],
        topModels: { tokens: [], requests: [], costs: [] },
        runs: [],
        nextRunCursor: null,
        facets: { providers: [], models: [] },
        hasDirectObservations: false,
        observationsWithoutRunId: 0,
      },
      sources: [],
      deliveryCoverage: [],
      unattributedCount: null,
      nextCursor: "call100",
      partialChildCount: 0,
      unboundedSummaryCount: 0,
      totals: {
        tokens: {
          inputTotal: 200,
          outputTotal: 100,
          total: 300,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
        },
        unknownTokenValues: 1,
        unknownTotalTokenCount: 1,
        partialCount: 2,
        unknownCount: 3,
        providerAttempts: 101,
        logicalRuns: 5,
        reportedSummaries: 0,
        diagnosticCount: 1,
        costs: [{ amount: "1.25", currency: "USD", basis: "estimated" }],
        unknownCostCount: 4,
      },
    } satisfies UsagePeriodReport;
    const report = buildUsageReport(source);
    expect(report.attempts).toBe(101);
    expect(report.totals.tokens.total).toBe(300);
    expect(report.rows).toEqual([]);
    expect(report.hasMore).toBe(true);
  });
});
