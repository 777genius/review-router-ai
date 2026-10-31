import { describe, expect, it } from "vitest";
import { usageMetricCatalog } from "../application/metric-catalog";

describe("Usage metric catalog", () => {
  it("does not mix cost currencies or selected spend with provider attempts", () => {
    expect(new Set(usageMetricCatalog.map((metric) => metric.id)).size).toBe(3);
    expect(usageMetricCatalog.find((metric) => metric.id === "usage.cost.known"))
      .toMatchObject({
        grain: "eligible_spend",
        requiresCurrencyAndBasis: true,
        unknownPolicy: "separate_unknown_counter",
      });
    expect(usageMetricCatalog.find((metric) => metric.id === "usage.provider_attempts"))
      .toMatchObject({
        grain: "original_provider_attempt",
        aggregation: "count",
        requiresCurrencyAndBasis: false,
      });
  });
});
