import type { UsageCost, UsageTokens } from "./usage";
import {
  validateUsagePriceSnapshot,
  type UsagePriceSnapshot,
} from "./usage-price";

export function canonicalPriceProvider(
  provider: string,
): "openai" | "anthropic" | "openrouter" | null {
  if (provider === "codex" || provider === "openai") return "openai";
  if (provider === "claude" || provider === "anthropic") return "anthropic";
  return provider === "openrouter" ? "openrouter" : null;
}
const scale = 1_000_000_000_000n;
function priceUnits(value: string | null): bigint | null {
  if (value === null || !/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(12, "0"));
}
/** Estimates only from the snapshot frozen before this request; never looks up current prices. */
export function estimateUsageCost(input: {
  readonly snapshot: UsagePriceSnapshot | null;
  readonly tokens: UsageTokens;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tier: string | null;
  readonly occurredAt: string;
}): UsageCost | null {
  const { snapshot, tokens } = input;
  if (snapshot) {
    try {
      validateUsagePriceSnapshot(snapshot);
    } catch {
      return null;
    }
  }
  if (
    !snapshot ||
    !input.provider ||
    canonicalPriceProvider(input.provider) !== snapshot.provider ||
    input.model !== snapshot.model ||
    input.tier !== snapshot.tier ||
    snapshot.unit !== "million_tokens" ||
    snapshot.currency !== "USD" ||
    !snapshot.version ||
    !snapshot.source
  )
    return null;
  const observed = Date.parse(snapshot.asOf);
  const occurred = Date.parse(input.occurredAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(occurred) ||
    observed > occurred
  )
    return null;
  const quantities = [
    tokens.inputTotal,
    tokens.outputTotal,
    tokens.cacheRead,
    tokens.cacheWrite,
  ];
  if (
    quantities.some(
      (value) => value === null || !Number.isSafeInteger(value) || value < 0,
    )
  )
    return null;
  const inputTotal = tokens.inputTotal!;
  const outputTotal = tokens.outputTotal!;
  const cacheRead = tokens.cacheRead!;
  const cacheWrite = tokens.cacheWrite!;
  if (cacheRead + cacheWrite > inputTotal) return null;
  const buckets = [
    [inputTotal - cacheRead - cacheWrite, snapshot.inputPerMillion],
    [outputTotal, snapshot.outputPerMillion],
    [cacheRead, snapshot.cacheReadPerMillion],
    [cacheWrite, snapshot.cacheWritePerMillion],
  ] as const;
  let numerator = 0n;
  for (const [quantity, price] of buckets) {
    if (quantity === 0) continue;
    const units = priceUnits(price);
    if (units === null) return null;
    numerator += BigInt(quantity) * units;
  }
  // Round once to 12 decimal USD places, after summing non-overlapping billing buckets.
  const units = (numerator + 500_000n) / 1_000_000n;
  const amount =
    `${units / scale}.${String(units % scale).padStart(12, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0";
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(amount)) return null;
  return {
    amount,
    currency: snapshot.currency,
    basis: "estimated",
    source: snapshot.source,
    asOf: snapshot.asOf,
    priceVersion: snapshot.version,
  };
}
