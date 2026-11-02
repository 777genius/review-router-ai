import { describe, expect, it } from "vitest";
import {
  listReviewModelOptions,
  catalogSnapshotOptions,
  listStaticReviewModelOptions,
  normalizeOpenRouterModelsResponse,
  OpenRouterModelCatalogAdapter,
  localCatalogModels,
  type ProviderCatalogModel,
  type ProviderModelCatalogSnapshot,
} from "../index";

function snapshot(
  models: readonly ProviderCatalogModel[],
  overrides: Partial<ProviderModelCatalogSnapshot> = {},
): ProviderModelCatalogSnapshot {
  return {
    providerKind: "openrouter",
    models,
    source: "openrouter",
    fetchedAt: 1,
    lastAttemptAt: 1,
    state: "fresh",
    error: null,
    refresh: "updated",
    ...overrides,
  };
}

const routerRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  context_length: 131_072,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools"],
  pricing: { prompt: "0", completion: "0" },
  ...extra,
});

describe("provider model catalog", () => {
  it("opts into catalog-admitted routing ids only for qualified transports and keeps capability failures closed", () => {
    const routing: ProviderCatalogModel = {
      id: "openrouter/catalog-route",
      name: "Catalog routing model",
      contextTokens: 128000,
      textInput: true,
      textOutput: true,
      toolCalling: true,
      pricing: null,
    };
    const data = snapshot([
      routing,
      { ...routing, id: "openrouter/unknown-tools", toolCalling: null },
    ]);
    expect(
      catalogSnapshotOptions(data).find((option) => option.value === routing.id)
        ?.disabled,
    ).toBe(true);
    const gateway = catalogSnapshotOptions(data, { allowRoutingModels: true });
    expect(
      gateway.find((option) => option.value === routing.id)?.disabled,
    ).not.toBe(true);
    expect(
      gateway.find((option) => option.value === "openrouter/unknown-tools")
        ?.disabled,
    ).toBe(true);
  });

  it("lists static Codex and Claude options", () => {
    const options = listStaticReviewModelOptions();

    expect(options.some((option) => option.provider === "codex")).toBe(true);
    expect(options[0]).toMatchObject({
      provider: "codex",
      value: "gpt-5.6-sol",
    });
    expect(options).toContainEqual(
      expect.objectContaining({
        provider: "claude",
        value: "sonnet",
      }),
    );
  });

  it("combines static options with OpenRouter adapter models", async () => {
    const options = await listReviewModelOptions({
      modelCatalog: {
        listModels: async ({ providerKind }) => ({
          providerKind,
          models:
            providerKind === "openrouter"
              ? [
                  {
                    id: "vendor/test:free",
                    name: "Test",
                    contextTokens: null,
                    textInput: true,
                    textOutput: true,
                    toolCalling: true,
                    pricing: null,
                  },
                ]
              : [],
          source: "local",
          fetchedAt: null,
          lastAttemptAt: null,
          state: "fallback",
          error: null,
          refresh: "cached",
        }),
      },
    });

    expect(options.map((option) => option.provider)).toContain("claude");
    expect(options.map((option) => option.value)).toContain("vendor/test:free");
  });

  it("does not label unknown OpenRouter pricing as paid", () => {
    const models = [
      { id: "vendor/unknown", pricing: null },
      {
        id: "vendor/partly-unknown",
        pricing: {
          currency: "USD" as const,
          unit: "million_tokens" as const,
          input: 0,
          output: null,
        },
      },
      {
        id: "vendor/paid",
        pricing: {
          currency: "USD" as const,
          unit: "million_tokens" as const,
          input: 2,
          output: null,
        },
      },
      {
        id: "vendor/free",
        pricing: {
          currency: "USD" as const,
          unit: "million_tokens" as const,
          input: 0,
          output: 0,
        },
      },
    ].map((model) => ({
      ...model,
      name: model.id,
      contextTokens: null,
      textInput: true,
      textOutput: true,
      toolCalling: true,
    }));
    const options = catalogSnapshotOptions({
      providerKind: "openrouter",
      models,
      source: "openrouter",
      fetchedAt: 1,
      lastAttemptAt: 1,
      state: "fresh",
      error: null,
      refresh: "updated",
    });
    expect(
      options.find((option) => option.value === "vendor/unknown")?.badge,
    ).toBeUndefined();
    expect(
      options.find((option) => option.value === "vendor/partly-unknown")?.badge,
    ).toBeUndefined();
    expect(
      options.find((option) => option.value === "vendor/paid")?.badge,
    ).toBe("PAID");
    expect(
      options.find((option) => option.value === "vendor/free")?.badge,
    ).toBe("FREE");
  });

  it("normalizes and sorts OpenRouter models for review suitability", () => {
    const models = normalizeOpenRouterModelsResponse({
      data: [
        {
          id: "openrouter/router-owned",
          name: "Router owned",
          pricing: { prompt: "0", completion: "0" },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
        {
          id: "poolside/laguna-m.1:free",
          name: "Poolside: Laguna M.1 (free)",
          pricing: { prompt: "0", completion: "0" },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
        {
          id: "openai/gpt-5.3-codex",
          name: "OpenAI: GPT-5.3 Codex",
          pricing: { prompt: "0.000001", completion: "0.000008" },
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
        },
      ],
    });
    const adapter = new OpenRouterModelCatalogAdapter({
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      now: () => 1,
    });

    expect(models[0]?.id).toBe("openai/gpt-5.3-codex");
    expect(models.at(-1)?.id).toBe("openrouter/router-owned");
    expect(adapter).toBeInstanceOf(OpenRouterModelCatalogAdapter);
  });

  it("uses the same OpenRouter metadata and ordering through both catalog entrypoints", async () => {
    const catalog = new OpenRouterModelCatalogAdapter({
      fetchImpl: async () =>
        Response.json({
          data: [
            routerRow("vendor/paid", {
              pricing: { prompt: "0.000002", completion: "0.000008" },
            }),
            routerRow("vendor/free"),
            routerRow("openai/gpt-oss-120b:free"),
            routerRow("vendor/image", {
              architecture: {
                input_modalities: ["image"],
                output_modalities: ["image"],
              },
            }),
            routerRow("openrouter/free"),
          ],
        }),
      now: () => 7,
    });
    const publicSnapshot = await catalog.listModels({
      providerKind: "openrouter",
    });
    const options = catalogSnapshotOptions(publicSnapshot);
    const legacy = await catalog.getOpenRouterCatalog();
    expect(options.map(({ value }) => value)).toEqual(
      legacy.map(({ id }) => id),
    );
    expect(options[0]).toMatchObject({
      value: "openai/gpt-oss-120b:free",
      badge: "FREE RECOMMENDED",
    });
    expect(
      options.find(({ value }) => value === "vendor/paid")?.description,
    ).toContain("$2.00/$8.00 per 1M input/output. 131,072 token context");
    expect(
      options.find(({ value }) => value === "vendor/free")?.description,
    ).toContain("Public catalog; account access not checked");
    expect(options.find(({ value }) => value === "vendor/image")).toMatchObject(
      { disabled: true, badge: "Unsupported" },
    );
    expect(
      options.find(({ value }) => value === "openrouter/free"),
    ).toMatchObject({ disabled: true, badge: "Unsupported" });
  });

  it("requires confirmed capabilities for agent models while allowing text-only engine choices", () => {
    const model: ProviderCatalogModel = {
      id: "vendor/text",
      name: "Text",
      contextTokens: null,
      textInput: true,
      textOutput: true,
      toolCalling: null,
      pricing: null,
    };
    expect(catalogSnapshotOptions(snapshot([model]))[0]).toMatchObject({
      disabled: true,
    });
    expect(
      catalogSnapshotOptions(snapshot([model]), { requiresTools: false })[0]
        ?.disabled,
    ).toBeUndefined();
    expect(
      catalogSnapshotOptions(snapshot([{ ...model, textOutput: false }]), {
        requiresTools: false,
      })[0],
    ).toMatchObject({ disabled: true });
  });

  it("keeps approved fallback choices available with honest provenance and unknown prices", () => {
    const fallback = localCatalogModels("openrouter");
    const options = catalogSnapshotOptions(
      snapshot(fallback, {
        source: "local",
        state: "fallback",
        fetchedAt: null,
        error: "source_unavailable",
      }),
    );
    expect(
      fallback.every(
        ({ pricing, contextTokens }) =>
          pricing === null && contextTokens === null,
      ),
    ).toBe(true);
    expect(
      options.every(
        ({ disabled, description }) =>
          !disabled &&
          description?.includes(
            "Built-in fallback; public metadata unavailable.",
          ),
      ),
    ).toBe(true);
    expect(
      options.every(
        ({ badge }) => badge !== "FREE" && badge !== "FREE RECOMMENDED",
      ),
    ).toBe(true);
    const stale = catalogSnapshotOptions(
      snapshot(
        [
          {
            id: "vendor/stale",
            name: "Stale",
            contextTokens: 1000,
            textInput: true,
            textOutput: true,
            toolCalling: true,
            pricing: null,
          },
        ],
        { state: "stale" },
      ),
    );
    expect(stale[0]?.description).toContain(
      "Cached public catalog; account access not checked.",
    );
  });

  it("does not infer FREE from a suffix, name, partial prices, or cache charges", async () => {
    const catalog = new OpenRouterModelCatalogAdapter({
      fetchImpl: async () =>
        Response.json({
          data: [
            routerRow("vendor/paid:free", {
              name: "Paid (free)",
              pricing: { prompt: "0.000002", completion: "0.000008" },
            }),
            routerRow("vendor/unknown:free", { pricing: { prompt: "0" } }),
            routerRow("vendor/cache", {
              pricing: {
                prompt: "0",
                completion: "0",
                input_cache_read: "0.000001",
              },
            }),
            routerRow("vendor/cache-write", {
              pricing: {
                prompt: "0",
                completion: "0",
                input_cache_write: "0.000001",
              },
            }),
            routerRow("vendor/tiny-price", {
              pricing: { prompt: "0.0000000000001", completion: "0" },
            }),
            routerRow("vendor/really-free"),
          ],
        }),
    });
    const options = catalogSnapshotOptions(
      await catalog.listModels({ providerKind: "openrouter" }),
    );
    const badges = Object.fromEntries(
      options.map(({ value, badge }) => [value, badge]),
    );
    expect(badges).toEqual({
      "vendor/paid:free": "PAID",
      "vendor/unknown:free": undefined,
      "vendor/cache": "PAID",
      "vendor/cache-write": "PAID",
      "vendor/tiny-price": "PAID",
      "vendor/really-free": "FREE",
    });
    expect(
      (await catalog.getOpenRouterCatalog()).find(
        ({ id }) => id === "vendor/cache",
      )?.isFree,
    ).toBe(false);
    expect(
      options.find(({ value }) => value === "vendor/tiny-price")?.description,
    ).toContain("$0.0000001/$0");
  });
});
