import { describe, expect, it } from "vitest";
import type { UsageTotals } from "@reviewrouter/features-provider-usage";
import {
  chartNumber,
  costAxisLabel,
  customInterval,
  costsLabel,
  intervalLabel,
  humanUtc,
  humanUtcRange,
  isFreeModel,
  latencyLabel,
  metricLabel,
  observedPair,
  partialDayLabel,
  tokenCoverage,
  unreportedUsageNote,
  usagePricing,
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
    ).toBe("at least 130");
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
  it("names partial days in plain words: today so far, or the hour a rolling period starts", () => {
    const period = {
      from: "2026-11-12T09:30:00.000Z",
      to: "2026-11-19T09:30:00.000Z",
    };
    const now = new Date(period.to);
    const [first, middle] = utcDays(period.from, period.to);
    const last = utcDays(period.from, period.to).at(-1)!;
    expect(partialDayLabel(first!, period, now)).toBe("from 09:30 UTC");
    expect(partialDayLabel(middle!, period, now)).toBeNull();
    expect(partialDayLabel(last, period, now)).toBe("today so far");
    // A period that ended on an earlier day names its end instead of "today".
    expect(
      partialDayLabel(last, period, new Date("2026-11-20T01:00:00.000Z")),
    ).toBe("until 09:30 UTC");
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
      label: "All calls reported their tokens",
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
      label: "1,126 calls did not report all their tokens",
      detail:
        "79 calls reported no tokens · 1,047 calls reported only some of their tokens · 1,124 calls did not report a token total",
      incomplete: true,
    });
    expect(
      tokenCoverage({
        unknownCount: 0,
        partialCount: 1,
        unknownTotalTokenCount: 1,
      }).label,
    ).toBe("1 call did not report all its tokens");
    // A complete source flag with no total still never reads as complete.
    expect(
      tokenCoverage({
        unknownCount: 0,
        partialCount: 0,
        unknownTotalTokenCount: 2,
      }).label,
    ).toBe("2 calls did not report a token total");
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
  });
  it("labels a bucket free or subscription-priced only when every call in it is", () => {
    const free = { provider: "openrouter", requestedModel: "a/b:free" };
    const glm = { provider: "glm", requestedModel: "glm-5.3" };
    const codex = { provider: "codex", requestedModel: "gpt-5.6-sol" };
    const plans = ["claude", "codex", "glm", "grok", "kimi", "minimax"];
    expect(usagePricing([], ["gateway"], plans)).toBeUndefined();
    expect(usagePricing([free], ["gateway"], plans)).toBe("free_model");
    expect(usagePricing([glm, codex], ["gateway"], plans)).toBe("subscription");
    // A direct-route key may be pay-as-you-go: only the Gateway profile proves a plan.
    expect(usagePricing([codex], ["direct"], plans)).toBeUndefined();
    expect(usagePricing([codex], ["gateway", "direct"], plans)).toBeUndefined();
    expect(usagePricing([free, codex], ["gateway"], plans)).toBeUndefined();
    expect(
      usagePricing(
        [{ provider: "openrouter", requestedModel: "x/y" }],
        ["gateway"],
        plans,
      ),
    ).toBeUndefined();
  });
  // get-tok onboarding audit: a missing subscription cost read as lost usage.
  it("names each missing measurement in the footer and skips costs a plan explains", () => {
    const note = (
      models: {
        provider: string;
        route: "gateway" | "direct";
        unknownCostCount: number;
      }[],
      overall: Partial<UsageTotals> = {},
    ) =>
      unreportedUsageNote({
        totals: { ...totals, ...overall },
        subscriptionProviders: ["codex"],
        overview: {
          models: models.map(({ provider, route, unknownCostCount }) => ({
            provider,
            requestedModel: "model",
            route,
            observedModels: [],
            hasUnknownObservedModel: false,
            totals: { ...totals, unknownCostCount },
          })),
        },
      });
    const subscription = {
      provider: "codex",
      route: "gateway" as const,
      unknownCostCount: 8,
    };
    expect(note([subscription])).toBeNull();
    expect(
      note([subscription, { ...subscription, route: "direct" as const }]),
    ).toBe("△ 8 calls did not report their cost");
    expect(note([subscription], { unknownCount: 1 })).toBe(
      "△ 1 call did not report all its tokens",
    );
    expect(
      note([{ ...subscription, provider: "openrouter" }], {
        unknownTotalTokenCount: 2,
      }),
    ).toBe(
      "△ 2 calls did not report a token total · 8 calls did not report their cost",
    );
  });
});
