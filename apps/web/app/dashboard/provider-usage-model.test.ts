import { describe, it, expect } from "vitest";
import { buildUsageReport } from "../../src/server/provider-usage-view-model";
import type { UsagePeriodReport } from "@reviewrouter/features-provider-usage";
function usageReportFixture(): UsagePeriodReport {
  return {
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
}
describe("safe usage browser projection", () => {
  it("preserves full-period totals even if the page is empty", () => {
    const source = usageReportFixture();
    const report = buildUsageReport(source);
    expect(report.attempts).toBe(101);
    expect(report.totals.tokens.total).toBe(300);
    expect(report.rows).toEqual([]);
    expect(report.hasMore).toBe(true);
  });
  it("shows the latest source update without claiming all sources are current", () => {
    const source = usageReportFixture();
    source.sources = [
      {
        sourceInstance: "old",
        coveredFrom: source.from,
        asOf: "2026-10-30T19:40:12.000Z",
        lagMs: 1000,
      },
      {
        sourceInstance: "current",
        coveredFrom: source.from,
        asOf: "2026-11-10T16:44:32.000Z",
        lagMs: 10,
      },
      {
        sourceInstance: "pending",
        coveredFrom: source.from,
        asOf: null,
        lagMs: null,
      },
    ];
    const report = buildUsageReport(source);
    expect(report.asOf).toBe("2026-11-10T16:44:32.000Z");
    expect(report.sourceLag).toBe("unknown");
    expect(report.sources).toEqual(source.sources);
    expect(report.totals).toEqual(source.totals);
  });
  it("uses proven requested-provider annotation without manufacturing observed usage", () => {
    const source = usageReportFixture();
    const identity = {
      callId: "call",
      workspaceId: "workspace",
      repositoryId: "repository",
      actorId: "actor",
      runId: "run",
      runAttempt: 1,
      invocationId: "invocation",
      attemptId: "attempt",
      bindingId: "binding",
      authorizationId: "authorization",
      route: "gateway" as const,
      purpose: "review" as const,
      provider: "codex",
      requestedModel: "nemotron",
      runtimeType: "ocr",
      parentScope: null,
      granularity: "call" as const,
      occurredAt: "2026-10-21T00:00:00.000Z",
    };
    source.rows = [
      {
        identity,
        requestedProvider: "openrouter",
        usage: null,
        lifecycle: null,
      },
      {
        identity: { ...identity, callId: "unproven" },
        usage: null,
        lifecycle: null,
      },
    ];
    const report = buildUsageReport(source);
    expect(report.rows[0]).toMatchObject({
      provider: "openrouter",
      requestedProvider: "openrouter",
      requestedModel: "nemotron",
      actualProvider: null,
      actualModel: null,
      total: null,
      cost: null,
      completeness: "unknown",
    });
    expect(report.rows[1]).toMatchObject({
      provider: "codex",
      requestedProvider: "codex",
      actualProvider: null,
    });
    expect(source.rows[0]!.identity.provider).toBe("codex");
    expect(report.totals).toEqual(source.totals);
    expect(JSON.stringify(report)).not.toContain("authorization");
  });
});
