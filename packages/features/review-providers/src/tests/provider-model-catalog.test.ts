import { describe, expect, it } from "vitest";
import {
  listReviewModelOptions,
  catalogSnapshotOptions,
  listStaticReviewModelOptions,
  normalizeOpenRouterModelsResponse,
  OpenRouterModelCatalogAdapter,
} from "../index";

describe("provider model catalog", () => {
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
});
