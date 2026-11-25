import { describe, expect, it, vi } from "vitest";
import { PublicModelPriceSnapshotReader } from "./public-model-price-snapshot";
import { estimateUsageCost } from "../domain/estimate-usage-cost";
import {
  validateUsagePriceSnapshot,
  type UsagePriceSnapshot,
} from "../domain/usage-price";

const observedAt = "2026-10-21T10:00:00.000Z";
const occurredAt = "2026-10-21T10:01:00.000Z";
const publicCatalog = (fetchedAt = Date.parse(observedAt)) => ({
  source: "models.dev",
  state: "fresh",
  fetchedAt,
  models: [
    {
      id: "native-model",
      pricing: { currency: "USD", unit: "million_tokens", input: 2, output: 8 },
    },
  ],
});
const tokens = {
  inputTotal: 1_000_000,
  outputTotal: 500_000,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 100_000,
  total: 1_500_000,
};
const readInput = {
  provider: "codex",
  model: "native-model",
  tier: "standard",
  occurredAt,
};

describe("captured public model prices", () => {
  it("captures exact native model, source, units and estimates non-overlapping buckets with exact decimal math", async () => {
    const listModels = vi.fn(async () => publicCatalog());
    const snapshot = await new PublicModelPriceSnapshotReader({
      listModels,
    }).read(readInput);
    expect(listModels).toHaveBeenCalledWith({ providerKind: "codex" });
    expect(snapshot).toMatchObject({
      provider: "openai",
      model: "native-model",
      tier: "standard",
      currency: "USD",
      unit: "million_tokens",
      asOf: observedAt,
      inputPerMillion: "2",
      outputPerMillion: "8",
      cacheReadPerMillion: null,
    });
    validateUsagePriceSnapshot(snapshot);
    expect(
      estimateUsageCost({
        snapshot,
        tokens,
        provider: "openai",
        model: "native-model",
        tier: "standard",
        occurredAt,
      }),
    ).toMatchObject({
      amount: "6",
      basis: "estimated",
      asOf: observedAt,
      priceVersion: snapshot?.version,
    });
    // Reasoning is already included in outputTotal and must never add another output charge.
    expect(
      estimateUsageCost({
        snapshot,
        tokens: { ...tokens, reasoning: 0 },
        provider: "openai",
        model: "native-model",
        tier: "standard",
        occurredAt,
      })?.amount,
    ).toBe("6");
  });

  it("preserves the full OpenRouter request ID and treats unresolved aliases as unknown", async () => {
    const listModels = vi.fn(async () => ({
      ...publicCatalog(),
      source: "openrouter",
      models: [
        {
          id: "vendor/model:free",
          pricing: {
            currency: "USD",
            unit: "million_tokens",
            input: 0,
            output: 0,
          },
        },
      ],
    }));
    const reader = new PublicModelPriceSnapshotReader({ listModels });
    expect(
      await reader.read({
        ...readInput,
        provider: "openrouter",
        model: "vendor/model:free",
      }),
    ).toMatchObject({
      provider: "openrouter",
      model: "vendor/model:free",
      inputPerMillion: "0",
      outputPerMillion: "0",
    });
    expect(listModels).toHaveBeenCalledWith({ providerKind: "openrouter" });
    const nativeReader = new PublicModelPriceSnapshotReader({
      listModels: async () => publicCatalog(),
    });
    expect(
      await nativeReader.read({
        ...readInput,
        provider: "claude",
        model: "sonnet",
      }),
    ).toBeNull();
  });

  it("keeps a captured version fixed across price changes and refuses historical fresh-price backfill", async () => {
    const listModels = vi.fn(async () => publicCatalog());
    const reader = new PublicModelPriceSnapshotReader({ listModels });
    const captured = await reader.read(readInput);
    listModels.mockResolvedValue({
      ...publicCatalog(Date.parse("2026-10-21T11:00:00Z")),
      models: [
        {
          id: "native-model",
          pricing: {
            currency: "USD",
            unit: "million_tokens",
            input: 200,
            output: 800,
          },
        },
      ],
    });
    expect(await reader.read(readInput)).toBeNull();
    expect(
      estimateUsageCost({
        snapshot: captured,
        tokens,
        provider: "codex",
        model: "native-model",
        tier: "standard",
        occurredAt,
      })?.amount,
    ).toBe("6");
    expect(
      await reader.read({ ...readInput, occurredAt: "2026-10-21T11:01:00Z" }),
    ).toMatchObject({ inputPerMillion: "200" });
    expect(
      await reader.read({
        ...readInput,
        model: "openai/native-model",
        occurredAt: "2026-10-21T11:01:00Z",
      }),
    ).toBeNull();
  });

  it("returns unknown for absent cache subdivisions/rates, nonstandard tiers or actual model mismatch", async () => {
    const reader = new PublicModelPriceSnapshotReader({
      listModels: async () => publicCatalog(),
    });
    const snapshot = await reader.read(readInput);
    const estimate = (
      overrides: Partial<Parameters<typeof estimateUsageCost>[0]>,
    ) =>
      estimateUsageCost({
        snapshot,
        tokens,
        provider: "openai",
        model: "native-model",
        tier: "standard",
        occurredAt,
        ...overrides,
      });
    expect(estimate({ tokens: { ...tokens, cacheRead: null } })).toBeNull();
    expect(estimate({ tokens: { ...tokens, cacheRead: 1 } })).toBeNull();
    expect(estimate({ tier: null })).toBeNull();
    expect(estimate({ tier: "priority" })).toBeNull();
    expect(estimate({ model: "actual-different" })).toBeNull();
    expect(await reader.read({ ...readInput, tier: "priority" })).toBeNull();
    expect(await reader.read({ ...readInput, tier: null })).toBeNull();
    const cachedRate = await new PublicModelPriceSnapshotReader({
      listModels: async () => ({
        ...publicCatalog(),
        models: [
          {
            id: "native-model",
            pricing: {
              currency: "USD",
              unit: "million_tokens",
              input: 2,
              output: 8,
              cacheRead: 0.1,
            },
          },
        ],
      }),
    }).read(readInput);
    expect(
      estimate({
        snapshot: cachedRate,
        tokens: { ...tokens, cacheRead: 250_000 },
      })?.amount,
    ).toBe("5.525");

    const pricedCache = {
      ...snapshot!,
      cacheReadPerMillion: "0.1",
      cacheWritePerMillion: "3",
    } satisfies UsagePriceSnapshot;
    expect(
      estimate({
        snapshot: pricedCache,
        tokens: { ...tokens, cacheRead: 250_000, cacheWrite: 250_000 },
      })?.amount,
    ).toBe("5.775");
  });

  it("retains unknown prices and rejects unsafe persisted snapshots", async () => {
    const reader = new PublicModelPriceSnapshotReader({
      listModels: async () => ({ ...publicCatalog(), state: "fallback" }),
    });
    expect(await reader.read(readInput)).toBeNull();
    const tiny = await new PublicModelPriceSnapshotReader({
      listModels: async () => ({
        ...publicCatalog(),
        models: [
          {
            id: "native-model",
            pricing: {
              currency: "USD",
              unit: "million_tokens",
              input: 0.0000000000001,
              output: 8,
            },
          },
        ],
      }),
    }).read(readInput);
    expect(tiny?.inputPerMillion).toBeNull();
    const snapshot = await new PublicModelPriceSnapshotReader({
      listModels: async () => publicCatalog(),
    }).read(readInput);
    expect(() =>
      validateUsagePriceSnapshot({ ...snapshot, extra: "unsafe" }),
    ).toThrow("usage_invalid_price_snapshot");
    expect(() =>
      validateUsagePriceSnapshot({ ...snapshot, inputPerMillion: "2e9" }),
    ).toThrow("usage_invalid_price_snapshot");
  });
});
