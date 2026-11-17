import { describe, expect, it } from "vitest";
import type { UsageTotals } from "@reviewrouter/features-provider-usage";
import {
  chartNumber,
  costAxisLabel,
  customInterval,
  costsLabel,
  intervalLabel,
  humanUtc,
  allFreeModels,
  humanUtcRange,
  isFreeModel,
  latencyLabel,
  metricLabel,
  observedPair,
  tokenCoverage,
  utcDays,
} from "./provider-usage-format";
const totals: UsageTotals = {
  tokens: {
    inputTotal: 100,
    outputTotal: 30,
    total: 130,
    cacheRead: 0,
    cacheWrite: null,
    reasoning: null,
  },
  unknownTokenValues: 2,
  unknownTotalTokenCount: 0,
  unknownCount: 0,
  partialCount: 0,
  unknownCostCount: 0,
  costs: [{ currency: "USD", basis: "estimated", amount: "0.000000000001" }],
  providerAttempts: 1,
  logicalRuns: 1,
  diagnosticCount: 0,
  reportedSummaries: 0,
};
describe("usage presentation invariants", () => {
  it("keeps sub-cent cost axis ticks distinct from zero", () => {
    expect(costAxisLabel(0)).toBe("0");
    expect(costAxisLabel(0.001)).toBe("0.001");
    expect(costAxisLabel(0.000000000001)).toBe("1E-12");
    expect(costAxisLabel(0.012345)).toBe("0.0123");
    expect(costAxisLabel(1500)).toBe("1.5K");
  });
  it("does not treat optional token fields as missing totals, while preserving actual unknown and zero totals", () => {
    expect(metricLabel(totals, "tokens", undefined)).toBe("130");
    expect(
      metricLabel(
        { ...totals, unknownTotalTokenCount: 1 },
        "tokens",
        undefined,
      ),
    ).toBe("130 (known part)");
    expect(
      metricLabel(
        { ...totals, tokens: { ...totals.tokens, total: null } },
        "tokens",
        undefined,
      ),
    ).toBe("Not reported");
    expect(
      metricLabel(
        { ...totals, tokens: { ...totals.tokens, total: 0 } },
        "tokens",
        undefined,
      ),
    ).toBe("0");
  });
  it("keeps exact cost strings and separate currency/basis authority even when chart scales are numeric", () => {
    expect(
      metricLabel(totals, "cost", { currency: "USD", basis: "estimated" }),
    ).toBe("0.000000000001 USD (estimated)");
    expect(
      metricLabel(totals, "cost", {
        currency: "USD",
        basis: "source_reported",
      }),
    ).toBe("No USD source reported amount");
    expect(costsLabel(totals, "EUR")).toBe("No EUR amount");
    expect(costsLabel({ ...totals, costs: [] }, "USD")).toBe("Not reported");
    expect(
      costsLabel(
        {
          ...totals,
          costs: [{ currency: "USD", basis: "estimated", amount: "0" }],
        },
        "USD",
      ),
    ).toBe("0 USD (estimated)");
    expect(chartNumber("1e400")).toBeNull();
  });
  it("adapts inclusive UTC calendar dates independently of DST and rejects invalid or excessive intervals", () => {
    expect(customInterval("2026-03-28", "2026-03-29")).toEqual({
      from: "2026-03-28T00:00:00.000Z",
      to: "2026-03-30T00:00:00.000Z",
    });
    expect(customInterval("2026-02-30", "2026-03-01")).toHaveProperty("error");
    expect(customInterval("2025-01-01", "2026-01-02")).toHaveProperty("error");
    expect(utcDays("2026-03-28T12:00:00Z", "2026-03-30T00:00:00Z")).toEqual([
      { day: "2026-03-28", partial: true },
      { day: "2026-03-29", partial: false },
    ]);
  });
  it("renders a stable UTC date range with ASCII spaces across server and browser ICU versions", () => {
    expect(
      intervalLabel("2026-09-22T12:00:00.000Z", "2026-10-22T12:00:00.000Z"),
    ).toBe("Sep 22 – Oct 22, 2026 UTC");
  });
  it("formats run timestamps in UTC without browser locale or ISO noise", () => {
    expect(humanUtc("2026-10-22T15:12:33.999Z")).toBe(
      "Oct 22, 2026, 15:12 UTC",
    );
    expect(
      humanUtcRange("2026-10-22T15:12:33.999Z", "2026-10-22T16:20:00.000Z"),
    ).toBe("Oct 22, 2026, 15:12 - 16:20 UTC");
  });
  it("summarizes incomplete token data as an exact call count and keeps the source breakdown", () => {
    expect(tokenCoverage(totals)).toEqual({
      label: "Reported observations",
      detail: undefined,
      incomplete: false,
    });
    expect(
      tokenCoverage({
        unknownCount: 79,
        partialCount: 1047,
        unknownTotalTokenCount: 1124,
      }),
    ).toEqual({
      label: "1,126 calls with incomplete token data",
      detail:
        "79 calls without a usage report · 1,047 calls marked partial by the source · 1,124 calls without total tokens",
      incomplete: true,
    });
    expect(
      tokenCoverage({
        unknownCount: 0,
        partialCount: 1,
        unknownTotalTokenCount: 1,
      }).label,
    ).toBe("1 call with incomplete token data");
    // A complete source flag with no total still never reads as complete.
    expect(
      tokenCoverage({
        unknownCount: 0,
        partialCount: 0,
        unknownTotalTokenCount: 2,
      }).label,
    ).toBe("2 calls without total tokens");
  });
  it("labels omitted source fields as not reported without inventing values", () => {
    expect(observedPair(null, null)).toBe("Not reported");
    expect(observedPair("codex", null)).toBe("codex / Not reported");
    expect(latencyLabel(null, null)).toBe("Not reported");
    expect(latencyLabel(1250, null)).toBe("1,250 ms / Not reported");
  });
  it("proves zero cost only for OpenRouter free variants", () => {
    expect(
      isFreeModel({
        provider: "openrouter",
        requestedModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
      }),
    ).toBe(true);
    for (const identity of [
      { provider: "openrouter", requestedModel: "openai/gpt-5.3-codex" },
      { provider: "openrouter", requestedModel: "openrouter/free" },
      { provider: "openrouter", requestedModel: null },
      { provider: "codex", requestedModel: "vendor/model:free" },
      { provider: "codex", requestedModel: "gpt-5.6-sol" },
    ])
      expect(isFreeModel(identity)).toBe(false);
    expect(allFreeModels([])).toBe(false);
    expect(
      allFreeModels([
        { provider: "openrouter", requestedModel: "a/b:free" },
        { provider: "codex", requestedModel: "gpt-5.6-sol" },
      ]),
    ).toBe(false);
  });
});
