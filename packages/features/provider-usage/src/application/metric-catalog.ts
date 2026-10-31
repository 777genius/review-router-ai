/** Metadata about results already computed by Usage, not a second spend policy. */
export type UsageMetricDefinition = {
  readonly id: string;
  readonly version: 1;
  readonly label: string;
  readonly description: string;
  readonly unit: "tokens" | "attempts" | "money";
  readonly grain: "eligible_spend" | "original_provider_attempt";
  readonly aggregation: "known_sum" | "count";
  readonly dimensions: readonly ("day_provider" | "requested_model_route")[];
  readonly unknownPolicy: "always_known" | "separate_unknown_counter";
  readonly requiresCurrencyAndBasis: boolean;
};
export const usageMetricCatalog = [
  {
    id: "usage.tokens.total_known",
    version: 1,
    label: "Total tokens (known)",
    description: "Known reported total tokens; missing measurements remain unknown, not zero.",
    unit: "tokens",
    grain: "eligible_spend",
    aggregation: "known_sum",
    dimensions: ["day_provider", "requested_model_route"],
    unknownPolicy: "separate_unknown_counter",
    requiresCurrencyAndBasis: false,
  },
  {
    id: "usage.provider_attempts",
    version: 1,
    label: "Provider attempts",
    description: "Original eligible provider attempts, independent of summary spend suppression.",
    unit: "attempts",
    grain: "original_provider_attempt",
    aggregation: "count",
    dimensions: ["day_provider", "requested_model_route"],
    unknownPolicy: "always_known",
    requiresCurrencyAndBasis: false,
  },
  {
    id: "usage.cost.known",
    version: 1,
    label: "Known cost",
    description: "Exact spend separately for each currency and valuation basis; unavailable cost is not zero.",
    unit: "money",
    grain: "eligible_spend",
    aggregation: "known_sum",
    dimensions: ["day_provider", "requested_model_route"],
    unknownPolicy: "separate_unknown_counter",
    requiresCurrencyAndBasis: true,
  },
] as const satisfies readonly UsageMetricDefinition[];
export type UsageMetricId = (typeof usageMetricCatalog)[number]["id"];
