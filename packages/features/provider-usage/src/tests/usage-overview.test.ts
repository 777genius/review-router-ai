import { describe, expect, it } from "vitest";
import { fact } from "./fixture";
import { selectProjection, type UsageFact } from "../domain/usage";
import { buildUsagePeriodReport } from "../application/report-usage";
const query = {
  workspaceId: "workspace-1",
  actorId: null,
  access: "admin" as const,
  from: new Date("2026-10-01"),
  to: new Date("2026-11-01"),
};
function projection(
  id: string,
  identity: Partial<UsageFact["identity"]> = {},
  overrides: Partial<UsageFact> = {},
) {
  return selectProjection([
    fact({
      authority: identity.route === "direct" ? "runtime" : "native",
      ...overrides,
      eventId: id,
      identity: { ...fact().identity, callId: id, ...identity },
    }),
  ]);
}
describe("whole-period requested usage overview", () => {
  it("keeps distinct runs and complete run rows independent of both cursors and observed identities", () => {
    const calls = Array.from({ length: 105 }, (_, i) =>
      projection(
        `a-${String(i).padStart(3, "0")}`,
        {
          provider: i % 2 ? "B" : "A",
          requestedModel: i % 2 ? "Y" : "X",
          occurredAt:
            i % 2 ? "2026-10-20T10:00:00.000Z" : "2026-10-21T11:00:00.000Z",
        },
        { actualProvider: "upstream", actualModel: "observed-alias" },
      ),
    );
    calls.push(projection("z", { runId: "run-2", requestedModel: null }));
    const report = buildUsagePeriodReport(calls, query);
    expect(report.rows).toHaveLength(100);
    expect(report.nextCursor).toBe("a-099");
    expect(report.totals.providerAttempts).toBe(106);
    expect(report.totals.logicalRuns).toBe(2);
    expect(report.overview.runs[0]).toMatchObject({
      runId: "run-1",
      totals: {
        providerAttempts: 105,
        logicalRuns: 1,
        tokens: { total: 13650 },
      },
    });
    expect(report.overview.runs[0]!.identities).toEqual([
      { provider: "A", requestedModel: "X" },
      { provider: "B", requestedModel: "Y" },
    ]);
    const filtered = buildUsagePeriodReport(calls, {
      ...query,
      provider: "A",
      model: "X",
      limit: 1,
      after: "a-100",
    });
    expect(filtered.rows[0]!.identity.callId).toBe("a-102");
    expect(filtered.totals.providerAttempts).toBe(53);
    expect(filtered.overview.runs[0]).toMatchObject({
      firstOccurredAt: "2026-10-21T11:00:00.000Z",
      lastOccurredAt: "2026-10-21T11:00:00.000Z",
      identities: [{ provider: "A", requestedModel: "X" }],
      observedModels: ["observed-alias"],
      totals: { providerAttempts: 53 },
    });
    expect(filtered.overview.daily).toMatchObject([
      { day: "2026-10-21", provider: "A", totals: { providerAttempts: 53 } },
    ]);
    expect(filtered.overview.facets.providers).toEqual(["A", "B", "openai"]);
    expect(filtered.overview.facets.models).toContainEqual({
      provider: "openai",
      requestedModel: null,
    });
    const firstRun = buildUsagePeriodReport(calls, { ...query, limit: 1 });
    expect(firstRun.overview.nextRunCursor).toBe("run-1");
    const secondRun = buildUsagePeriodReport(calls, {
      ...query,
      limit: 1,
      runAfter: "run-1",
    });
    expect(secondRun.overview.runs.map((r) => r.runId)).toEqual(["run-2"]);
    expect(secondRun.rows).toEqual(firstRun.rows);
    expect(secondRun.overview.nextRunCursor).toBeNull();
  });
  it("orders run timestamps chronologically across mixed precision and resolves equal instants deterministically", () => {
    const rows = [
      projection("earlier", {
        runId: "mixed",
        occurredAt: "2026-10-21T10:00:00Z",
      }),
      projection("later", {
        runId: "mixed",
        occurredAt: "2026-10-21T10:00:00.001Z",
      }),
      projection("equal-short", {
        runId: "equal",
        occurredAt: "2026-10-21T10:00:00Z",
      }),
      projection("equal-fraction", {
        runId: "equal",
        occurredAt: "2026-10-21T10:00:00.0Z",
      }),
      projection("equal-millis", {
        runId: "equal",
        occurredAt: "2026-10-21T10:00:00.000Z",
      }),
    ];
    for (const ordered of [rows, [...rows].reverse()]) {
      const runs = buildUsagePeriodReport(ordered, query).overview.runs;
      expect(runs.find((run) => run.runId === "mixed")).toMatchObject({
        firstOccurredAt: "2026-10-21T10:00:00Z",
        lastOccurredAt: "2026-10-21T10:00:00.001Z",
      });
      expect(runs.find((run) => run.runId === "equal")).toMatchObject({
        firstOccurredAt: "2026-10-21T10:00:00.000Z",
        lastOccurredAt: "2026-10-21T10:00:00Z",
      });
    }
  });
  it("selects summary authority before dimensions and never allocates summary spend to child requests", () => {
    const common = { parentScope: "turn", invocationId: "invocation-1" };
    const a = projection("a", {
      ...common,
      provider: "A",
      requestedModel: "X",
    });
    const b = projection("b", {
      ...common,
      provider: "B",
      requestedModel: "Y",
    });
    const summary = projection(
      "s",
      {
        ...common,
        granularity: "turn",
        provider: "A",
        requestedModel: "X",
        occurredAt: "2026-10-22T00:00:00.000Z",
      },
      { childCallIds: ["a", "b"] },
    );
    const complete = buildUsagePeriodReport([a, b, summary], {
      ...query,
      provider: "A",
      model: "X",
    });
    expect(complete.totals.costs[0]!.amount).toBe("0.1");
    expect(complete.totals.reportedSummaries).toBe(0);
    const partialB = projection(
      "b",
      { ...common, provider: "B", requestedModel: "Y" },
      { completeness: "partial" },
    );
    const unbounded = projection("u", {
      granularity: "turn",
      provider: "A",
      requestedModel: "X",
    });
    const partial = buildUsagePeriodReport(
      [a, partialB, summary, unbounded],
      query,
    );
    expect(partial.totals.providerAttempts).toBe(2);
    expect(partial.totals.costs[0]!.amount).toBe("0.1");
    expect(partial.unboundedSummaryCount).toBe(1);
    expect(
      partial.overview.daily.find(
        (d) => d.provider === "A" && d.day === "2026-10-22",
      )!.totals,
    ).toMatchObject({ providerAttempts: 0, tokens: { total: 130 } });
    const childOnly = buildUsagePeriodReport([a, partialB, summary], {
      ...query,
      provider: "B",
      model: "Y",
    });
    expect(childOnly.totals).toMatchObject({
      providerAttempts: 1,
      tokens: { total: null },
      costs: [],
    });
    expect(childOnly.overview.runs[0]!.identities).toEqual([
      { provider: "B", requestedModel: "Y" },
    ]);
  });
  it("orders exact decimal cost separately by currency and basis, merges routes, and breaks ties deterministically", () => {
    const cost = fact().cost!;
    const rows = [
      projection(
        "a",
        { provider: "A", requestedModel: "X" },
        { cost: { ...cost, amount: "9007199254740991.000000000001" } },
      ),
      projection(
        "b",
        { provider: "B", requestedModel: "Y" },
        { cost: { ...cost, amount: "9007199254740991.000000000002" } },
      ),
      projection(
        "c",
        { provider: "A", requestedModel: "X", route: "direct" },
        { cost: { ...cost, amount: "0" } },
      ),
      projection(
        "d",
        { provider: "C", requestedModel: "Z" },
        { cost: { ...cost, amount: "0.2", currency: "EUR" } },
      ),
      projection(
        "e",
        { provider: "D", requestedModel: "W" },
        { cost: { ...cost, amount: "0.1", basis: "estimated" } },
      ),
    ];
    const report = buildUsagePeriodReport(rows, { ...query, after: "z" });
    expect(report.rows).toEqual([]);
    expect(report.overview.models).toHaveLength(5);
    expect(report.overview.topModels.tokens.map((m) => m.provider)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(report.overview.topModels.tokens[0]).toMatchObject({
      provider: "A",
      requestedModel: "X",
      totals: { providerAttempts: 2 },
    });
    const usd = report.overview.topModels.costs.find(
      (c) => c.currency === "USD" && c.basis === "source_reported",
    )!;
    expect(usd.models.map((m) => m.provider)).toEqual(["B", "A"]);
    expect(usd.models[1]!.totals.costs[0]!.amount).toBe(
      "9007199254740991.000000000001",
    );
    expect(report.overview.topModels.costs).toHaveLength(3);
    expect(report.overview.hasDirectObservations).toBe(true);
    expect(() => JSON.stringify(report.overview)).not.toThrow();
  });
  it("counts missing total-token values separately from optional token buckets", () => {
    const complete = projection(
      "complete",
      {},
      {
        tokens: { ...fact().tokens, cacheWrite: null, reasoning: null },
      },
    );
    const completeReport = buildUsagePeriodReport([complete], query);
    expect(completeReport.totals.unknownTokenValues).toBe(2);
    expect(completeReport.totals.unknownTotalTokenCount).toBe(0);
    const missingTotal = projection(
      "missing-total",
      {},
      {
        tokens: { ...fact().tokens, total: null },
        completeness: "partial",
      },
    );
    const mixedReport = buildUsagePeriodReport([complete, missingTotal], query);
    expect(mixedReport.totals.tokens.total).toBe(130);
    expect(mixedReport.totals.unknownTotalTokenCount).toBe(1);
    expect(mixedReport.overview.models[0]!.totals.unknownTotalTokenCount).toBe(
      1,
    );
  });
  it("retains unknown and known zero values, prepared runs, and null-run observations without inventing a run", () => {
    const zero = {
      inputTotal: 0,
      outputTotal: 0,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
      total: 0,
    };
    const rows = [
      projection(
        "zero",
        { requestedModel: "zero", runId: null },
        {
          tokens: zero,
          cost: { ...fact().cost!, amount: "0" },
          actualModel: null,
        },
      ),
      projection(
        "prepared",
        { requestedModel: "prepared" },
        {
          authority: "lifecycle",
          state: "prepared",
          dispatchEffect: "effect_unknown",
        },
      ),
      projection(
        "unknown",
        { requestedModel: "unknown", route: "direct" },
        {
          state: "unknown",
          completeness: "unknown",
          dispatchEffect: "effect_unknown",
          tokens: { ...zero, inputTotal: null, outputTotal: null, total: null },
          cost: null,
        },
      ),
    ];
    const report = buildUsagePeriodReport(rows, query);
    expect(report.totals).toMatchObject({
      providerAttempts: 2,
      logicalRuns: 1,
    });
    expect(report.overview.observationsWithoutRunId).toBe(1);
    expect(report.overview.runs).toHaveLength(1);
    expect(
      report.overview.models.find((m) => m.requestedModel === "zero"),
    ).toMatchObject({
      observedModels: [],
      hasUnknownObservedModel: true,
      totals: { tokens: { total: 0 }, costs: [{ amount: "0" }] },
    });
    expect(
      report.overview.models.find((m) => m.requestedModel === "unknown")!.totals
        .tokens.total,
    ).toBeNull();
    expect(
      report.overview.models.find((m) => m.requestedModel === "prepared")!
        .totals.providerAttempts,
    ).toBe(0);
  });
});
