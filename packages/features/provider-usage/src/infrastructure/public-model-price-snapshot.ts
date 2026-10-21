import { createHash } from "node:crypto";
import type {
  UsagePriceSnapshot,
  UsagePriceSnapshotReader,
} from "../application/ports";
import { canonicalPriceProvider } from "../domain/estimate-usage-cost";

/** Consumer-owned subset of the public model catalog; contains no account/binding data. */
export interface PublicModelPriceCatalog {
  listModels(input: {
    providerKind: "codex" | "claude" | "openrouter";
  }): Promise<{
    readonly source: string;
    readonly state: string;
    readonly fetchedAt: number | null;
    readonly models: readonly {
      readonly id: string;
      readonly pricing: {
        readonly currency: string;
        readonly unit: string;
        readonly input: number | null;
        readonly output: number | null;
        readonly cacheRead?: number | null;
      } | null;
    }[];
  }>;
}
export class PublicModelPriceSnapshotReader implements UsagePriceSnapshotReader {
  constructor(private readonly catalog: PublicModelPriceCatalog) {}
  async read(input: {
    provider: string;
    model: string;
    occurredAt: string;
    tier: string | null;
  }): Promise<UsagePriceSnapshot | null> {
    const provider = canonicalPriceProvider(input.provider);
    const occurredAt = Date.parse(input.occurredAt);
    if (!provider || input.tier !== "standard" || !Number.isFinite(occurredAt))
      return null;
    const providerKind =
      provider === "openai"
        ? "codex"
        : provider === "anthropic"
          ? "claude"
          : "openrouter";
    const snapshot = await this.catalog.listModels({ providerKind });
    if (
      !["fresh", "stale"].includes(snapshot.state) ||
      snapshot.source !==
        (provider === "openrouter" ? "openrouter" : "models.dev") ||
      snapshot.fetchedAt === null ||
      snapshot.fetchedAt > occurredAt ||
      !Number.isFinite(snapshot.fetchedAt)
    )
      return null;
    const pricing = snapshot.models.find(
      (model) => model.id === input.model,
    )?.pricing;
    if (
      !pricing ||
      pricing.currency !== "USD" ||
      pricing.unit !== "million_tokens"
    )
      return null;
    const decimal = (value: number | null) =>
      value !== null &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
        ? decimalNumber(value)
        : null;
    const prices = {
      inputPerMillion: decimal(pricing.input),
      outputPerMillion: decimal(pricing.output),
      cacheReadPerMillion: decimal(pricing.cacheRead ?? null),
      cacheWritePerMillion: null,
    };
    if (prices.inputPerMillion === null && prices.outputPerMillion === null)
      return null;
    const asOf = new Date(snapshot.fetchedAt).toISOString();
    const version = createHash("sha256")
      .update(
        JSON.stringify([
          provider,
          input.model,
          input.tier,
          snapshot.source,
          asOf,
          prices,
        ]),
      )
      .digest("hex");
    return {
      provider,
      model: input.model,
      tier: "standard",
      currency: "USD",
      unit: "million_tokens",
      source: snapshot.source,
      version,
      asOf,
      ...prices,
    };
  }
}
function decimalNumber(value: number): string | null {
  // Public prices have at most 12 useful decimal places; never accept exponent money DTOs.
  const formatted = value.toFixed(12).replace(/\.?0+$/, "");
  if (Number(formatted) !== value) return null;
  return /^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(formatted)
    ? formatted
    : value === 0
      ? "0"
      : null;
}
