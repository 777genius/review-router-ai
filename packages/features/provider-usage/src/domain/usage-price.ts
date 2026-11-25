export interface UsagePriceSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly tier: "standard";
  readonly currency: string;
  readonly unit: "million_tokens";
  readonly source: string;
  readonly version: string;
  readonly asOf: string;
  readonly inputPerMillion: string | null;
  readonly outputPerMillion: string | null;
  readonly cacheReadPerMillion: string | null;
  readonly cacheWritePerMillion: string | null;
}

export function validateUsagePriceSnapshot(
  value: unknown,
): asserts value is UsagePriceSnapshot {
  const invalid = () => {
    throw new Error("usage_invalid_price_snapshot");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const snapshot = value as Record<string, unknown>;
  const fields = [
    "provider",
    "model",
    "tier",
    "currency",
    "unit",
    "source",
    "version",
    "asOf",
    "inputPerMillion",
    "outputPerMillion",
    "cacheReadPerMillion",
    "cacheWritePerMillion",
  ];
  if (
    Object.keys(snapshot).length !== fields.length ||
    Object.keys(snapshot).some((key) => !fields.includes(key))
  )
    invalid();
  if (
    !["openai", "anthropic", "openrouter"].includes(
      String(snapshot.provider),
    ) ||
    typeof snapshot.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(snapshot.model) ||
    snapshot.model.includes("://") ||
    /^(?:sk-|ghp_|github_pat_|xox[baprs]-)/.test(snapshot.model) ||
    snapshot.tier !== "standard" ||
    snapshot.currency !== "USD" ||
    snapshot.unit !== "million_tokens" ||
    !["models.dev", "openrouter"].includes(String(snapshot.source)) ||
    typeof snapshot.version !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.version) ||
    typeof snapshot.asOf !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(snapshot.asOf) ||
    !Number.isFinite(Date.parse(snapshot.asOf))
  )
    invalid();
  for (const key of [
    "inputPerMillion",
    "outputPerMillion",
    "cacheReadPerMillion",
    "cacheWritePerMillion",
  ]) {
    const amount = snapshot[key];
    if (
      amount !== null &&
      (typeof amount !== "string" ||
        !/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(amount))
    )
      invalid();
  }
}
