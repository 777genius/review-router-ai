import { describe, expect, it } from "vitest";
import { selectProjection, selectReportFacts } from "../domain/usage";
import {
  aggregateUsage,
  buildUsagePeriodReport,
} from "../application/report-usage";
import {
  buildUsagePeriodReportFromAggregates,
  finalizeUsageTotals,
  type UsageAggregateTotals,
  type UsageReportAggregateBucket,
} from "../application/usage-report-aggregate";
import {
  classifyUsageContribution,
  usageContributionProfile,
} from "../application/usage-contribution";
import { fact } from "./fixture";

const query = {
  workspaceId: "workspace-1",
  actorId: null,
  access: "admin" as const,
  from: new Date("2026-10-01"),
  to: new Date("2026-11-01"),
  limit: 1,
};
function totals(
  overrides: Partial<UsageAggregateTotals> = {},
): UsageAggregateTotals {
  return {
    tokens: {
      inputTotal: "100",
      outputTotal: "30",
      cacheRead: "20",
      cacheWrite: "10",
      reasoning: "5",
      total: "130",
    },
    costs: [
      { currency: "USD", basis: "source_reported", amount: "0.100000000000" },
    ],
    unknownTokenValues: "0",
    unknownTotalTokenCount: "0",
    partialCount: "0",
    unknownCount: "0",
    providerAttempts: "1",
    logicalRuns: "1",
    reportedSummaries: "0",
    diagnosticCount: "0",
    unknownCostCount: "0",
    ...overrides,
  };
}
function bucket(
  kind: UsageReportAggregateBucket["kind"],
  overrides: Partial<UsageReportAggregateBucket> = {},
): UsageReportAggregateBucket {
  return {
    kind,
    provider: "openai",
    model: "gpt-test",
    route: "gateway",
    day: "2026-10-21",
    runId: null,
    totals: totals(),
    observedModels: ["gpt-test"],
    hasUnknownObservedModel: false,
    firstOccurredAt: null,
    lastOccurredAt: null,
    identities: [],
    routes: [],
    ...overrides,
  };
}

describe("usage contribution and aggregate contracts", () => {
  it("sums caller-supplied nondispatched spend while the report excludes it", () => {
    const p = selectProjection([
      fact({
        state: "failed",
        dispatchEffect: "not_dispatched",
        completeness: "partial",
        identity: { ...fact().identity, purpose: "diagnostic" },
      }),
    ]);
    expect(classifyUsageContribution(usageContributionProfile(p))).toEqual({
      includeSpend: false,
      providerAttempt: false,
      partialWeight: 1,
      unknownWeight: 0,
      diagnosticWeight: 1,
      summaryWeight: 0,
    });
    expect(aggregateUsage([p])).toMatchObject({
      tokens: { total: 130 },
      costs: [{ amount: "0.1" }],
      providerAttempts: 0,
      logicalRuns: 1,
      partialCount: 1,
      diagnosticCount: 1,
    });
    expect(buildUsagePeriodReport([p], query).totals).toMatchObject({
      tokens: { total: null },
      costs: [],
      providerAttempts: 0,
      logicalRuns: 1,
      partialCount: 0,
      diagnosticCount: 0,
    });
  });

  it("selects narrow metadata without losing duplicate objects or original order", () => {
    const child = {
      identity: {
        callId: "a",
        granularity: "call" as const,
        invocationId: "invocation",
        parentScope: null,
      },
      usage: { completeness: "complete" as const, childCallIds: null },
      marker: "first",
    };
    const duplicate = { ...child, marker: "duplicate" };
    const summary = {
      ...child,
      identity: {
        ...child.identity,
        callId: "s",
        granularity: "turn" as const,
      },
      usage: { completeness: "complete" as const, childCallIds: ["a"] },
    };
    const result = selectReportFacts([duplicate, summary, child]);
    expect(result.selected).toEqual([summary]);
    expect(result.partialChildren).toEqual([duplicate, child]);
    expect(result.partialChildren[0]).toBe(duplicate);
    expect(result.partialChildren[1]).toBe(child);
  });

  it("finalizes exact SQL values, retaining zero/null and rejecting unsafe token sums", () => {
    const raw = totals({
      tokens: {
        inputTotal: "0",
        outputTotal: null,
        cacheRead: null,
        cacheWrite: "0",
        reasoning: null,
        total: "0",
      },
      costs: [
        {
          currency: "EUR",
          basis: "estimated",
          amount: "9007199254740991.000000000002",
        },
        { currency: "USD", basis: "source_reported", amount: "0.000000000000" },
      ],
      unknownTokenValues: "3",
      unknownTotalTokenCount: "0",
    });
    expect(finalizeUsageTotals(raw)).toMatchObject({
      tokens: { inputTotal: 0, outputTotal: null, total: 0 },
      unknownTokenValues: 3,
      unknownTotalTokenCount: 0,
      costs: [
        { currency: "EUR", amount: "9007199254740991.000000000002" },
        { currency: "USD", amount: "0" },
      ],
    });
    expect(() =>
      finalizeUsageTotals({
        ...raw,
        tokens: { ...raw.tokens, total: "9007199254740992" },
      }),
    ).toThrow("usage_report_overflow");
    expect(() =>
      finalizeUsageTotals({ ...raw, logicalRuns: "9007199254740992" }),
    ).toThrow("usage_report_overflow");
  });

  it("assembles independent storage arithmetic into the complete pure report", () => {
    const a = selectProjection([
      fact({ identity: { ...fact().identity, callId: "a" } }),
    ]);
    const b = selectProjection([
      fact({
        eventId: "b",
        identity: { ...fact().identity, callId: "b", runId: "run-2" },
        state: "failed",
        dispatchEffect: "not_dispatched",
        actualModel: null,
      }),
    ]);
    const period = {
      totals: totals({ logicalRuns: "2" }),
      hasUnknownObservedModel: true,
    };
    const result = buildUsagePeriodReportFromAggregates({
      query,
      buckets: [
        bucket("totals", period),
        bucket("groups"),
        bucket("daily", period),
        bucket("modelRoute", period),
        bucket("modelRank", period),
        bucket("run", {
          runId: "run-1",
          firstOccurredAt: a.identity.occurredAt,
          lastOccurredAt: a.identity.occurredAt,
          identities: [{ provider: "openai", requestedModel: "gpt-test" }],
          routes: ["gateway"],
        }),
      ],
      facets: [{ provider: "openai", requestedModel: "gpt-test" }],
      rows: [a],
      nextCursor: null,
      nextRunCursor: "run-1",
      partialChildCount: 0,
      unboundedSummaryCount: 0,
      hasDirectObservations: false,
      observationsWithoutRunId: 0,
    });
    expect(result).toEqual(buildUsagePeriodReport([a, b], query));
    expect(
      buildUsagePeriodReportFromAggregates({
        query,
        buckets: [],
        facets: [],
        rows: [],
        nextCursor: null,
        nextRunCursor: null,
        partialChildCount: 0,
        unboundedSummaryCount: 0,
        hasDirectObservations: false,
        observationsWithoutRunId: 0,
      }),
    ).toEqual(buildUsagePeriodReport([], query));
  });

  it("keeps admitted raw midnight day spelling and original timestamp endpoints", () => {
    const rawMidnight = "2026-10-21T24:00:00Z";
    const rows = [rawMidnight, "2026-10-22T00:00:00.000Z"].map(
      (occurredAt, index) =>
        selectProjection([
          fact({
            identity: { ...fact().identity, callId: String(index), occurredAt },
          }),
        ]),
    );
    const report = buildUsagePeriodReport(rows, query);
    expect(report.overview.daily.map((day) => day.day)).toEqual([
      "2026-10-21",
      "2026-10-22",
    ]);
    expect(report.overview.runs[0]).toMatchObject({
      firstOccurredAt: rawMidnight,
      lastOccurredAt: "2026-10-22T00:00:00.000Z",
    });
  });
});
