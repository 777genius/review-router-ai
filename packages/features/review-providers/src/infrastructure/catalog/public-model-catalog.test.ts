import { describe, expect, it, vi } from "vitest";
import { catalogSnapshotOptions } from "../../domain/provider-model-catalog";
import {
  PublicProviderModelCatalogAdapter,
  normalizePublicCatalog,
  publicCatalogPolicy,
} from "./public-model-catalog";

const native = (id: string) => ({
  id,
  name: id,
  modalities: { input: ["text"], output: ["text"] },
  tool_call: true,
  limit: { context: 100_000 },
  cost: { input: 2, output: 8 },
});
const both = () => ({
  openai: { models: { a: native("native-openai") } },
  anthropic: { models: { b: native("native-anthropic") } },
});

describe("public provider catalog safety and refresh", () => {
  it("loads OpenRouter publicly, replaces live IDs, and reports failures without inventing a refresh", async () => {
    let now = 10;
    const row = (id: string) => ({
      id,
      name: id,
      context_length: 128_000,
      supported_parameters: ["tools"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0", completion: "0" },
    });
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [row("vendor/initial:free")] }),
    );
    const catalog = new PublicProviderModelCatalogAdapter({
      fetchImpl,
      now: () => now,
    });
    const initial = await catalog.listModels({ providerKind: "openrouter" });
    expect(initial).toMatchObject({
      source: "openrouter",
      state: "fresh",
      refresh: "updated",
      fetchedAt: 10,
    });
    expect(initial.models).toMatchObject([
      {
        id: "vendor/initial:free",
        contextTokens: 128_000,
        pricing: { input: 0, output: 0 },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        credentials: "omit",
        headers: {
          accept: "application/json",
          "user-agent": "ReviewRouter public-model-catalog/1.0",
        },
      }),
    );
    fetchImpl.mockRejectedValue(new Error("offline"));
    now += 10;
    const failedRefresh = await catalog.listModels({
      providerKind: "openrouter",
      forceRefresh: true,
    });
    expect(failedRefresh).toMatchObject({
      source: "openrouter",
      state: "fresh",
      refresh: "failed",
      fetchedAt: 10,
      lastAttemptAt: 20,
      error: "source_unavailable",
    });
    expect(failedRefresh.models).toEqual(initial.models);
    expect(
      await catalog.listModels({
        providerKind: "openrouter",
        forceRefresh: true,
      }),
    ).toMatchObject({ refresh: "cooldown", fetchedAt: 10 });
    now = 10 + publicCatalogPolicy.ttlMs;
    expect(
      await catalog.listModels({ providerKind: "openrouter" }),
    ).toMatchObject({
      source: "openrouter",
      state: "stale",
      fetchedAt: 10,
      error: "source_unavailable",
    });
    now = 11 + publicCatalogPolicy.staleMs;
    const expired = await catalog.listModels({ providerKind: "openrouter" });
    expect(expired).toMatchObject({
      source: "local",
      state: "fallback",
      refresh: "failed",
      fetchedAt: 10,
    });
    expect(expired.models.some(({ id }) => id === "vendor/initial:free")).toBe(
      false,
    );
    expect(
      catalogSnapshotOptions(expired).every(({ description }) =>
        description?.includes("Built-in fallback"),
      ),
    ).toBe(true);
    fetchImpl.mockResolvedValue(
      Response.json({ data: [row("vendor/new:free")] }),
    );
    now += publicCatalogPolicy.cooldownMs;
    const recovered = await catalog.listModels({ providerKind: "openrouter" });
    expect(recovered).toMatchObject({
      source: "openrouter",
      state: "fresh",
      refresh: "updated",
      fetchedAt: now,
      error: null,
    });
    expect(recovered.models.map(({ id }) => id)).toEqual(["vendor/new:free"]);
  });

  it("keeps invalid context and unsupported price structures unknown", () => {
    const rows = normalizePublicCatalog(
      {
        data: [
          {
            id: "vendor/fraction",
            context_length: 1.5,
            pricing: { prompt: "-1", completion: "NaN" },
          },
          { id: "vendor/zero", context_length: 0 },
          {
            id: "vendor/cache",
            context_length: 128_000,
            pricing: {
              prompt: "0",
              completion: "0",
              input_cache_write: "0.000001",
            },
          },
        ],
      },
      "openrouter",
    );
    expect(rows.find(({ id }) => id === "vendor/fraction")).toMatchObject({
      contextTokens: null,
      pricing: { input: null, output: null },
    });
    expect(
      rows.find(({ id }) => id === "vendor/zero")?.contextTokens,
    ).toBeNull();
    expect(rows.find(({ id }) => id === "vendor/cache")).toMatchObject({
      contextTokens: 128_000,
      pricing: { cacheWrite: 1 },
    });
  });

  it("keeps native namespaces and units, rejects conflicting IDs, and disables unknown tools", () => {
    const openai = normalizePublicCatalog(both(), "codex");
    const anthropic = normalizePublicCatalog(both(), "claude");
    expect(openai[0]).toMatchObject({
      id: "native-openai",
      pricing: { input: 2, output: 8, unit: "million_tokens" },
    });
    expect(anthropic[0]?.id).toBe("native-anthropic");
    const cache = normalizePublicCatalog(
      {
        openai: {
          models: {
            a: {
              ...native("cache"),
              cost: { input: 2, output: 8, cache_read: 0.2 },
            },
          },
        },
      },
      "codex",
    );
    expect(cache[0]?.pricing?.cacheRead).toBe(0.2);
    const conditional = normalizePublicCatalog(
      {
        data: [
          {
            id: "vendor/timed",
            pricing: {
              prompt: "0.000002",
              completion: "0.000008",
              overrides: [{ prompt: "0.000004" }],
            },
          },
        ],
      },
      "openrouter",
    );
    expect(conditional[0]?.pricing).toBeNull();
    const requestFee = normalizePublicCatalog(
      {
        data: [
          {
            id: "vendor/request-fee",
            pricing: {
              prompt: "0.000002",
              completion: "0.000008",
              request: "0.01",
            },
          },
        ],
      },
      "openrouter",
    );
    expect(requestFee[0]?.pricing).toBeNull();

    const router = normalizePublicCatalog(
      {
        data: [
          {
            id: "vendor/model:free",
            pricing: { prompt: "0.000002", completion: "0.000008" },
          },
        ],
      },
      "openrouter",
    );
    expect(router[0]).toMatchObject({
      id: "vendor/model:free",
      pricing: { input: 2, output: 8 },
      toolCalling: null,
      textInput: null,
    });
    expect(
      catalogSnapshotOptions({
        providerKind: "openrouter",
        models: router,
        source: "openrouter",
        state: "fresh",
        fetchedAt: 1,
        lastAttemptAt: 1,
        error: null,
        refresh: "updated",
      })[0],
    ).toMatchObject({ disabled: true });
    expect(() =>
      normalizePublicCatalog(
        {
          openai: {
            models: {
              a: native("same"),
              b: { ...native("same"), name: "different" },
            },
          },
        },
        "codex",
      ),
    ).toThrow("duplicate_conflict");
    const image = normalizePublicCatalog(
      {
        openai: {
          models: {
            a: {
              ...native("image"),
              modalities: { input: ["text"], output: ["image"] },
            },
          },
        },
      },
      "codex",
    );
    expect(image[0]?.textOutput).toBe(false);
  });

  it("single-flights both sections, isolates a cancelled waiter, and retains independent section failures", async () => {
    let now = 0;
    let release!: (value: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const catalog = new PublicProviderModelCatalogAdapter({
      fetchImpl,
      now: () => now,
    });
    const controller = new AbortController();
    const cancelled = catalog.listModels({
      providerKind: "codex",
      signal: controller.signal,
    });
    const other = catalog.listModels({ providerKind: "claude" });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    release(Response.json(both()));
    expect(await other).toMatchObject({
      state: "fresh",
      fetchedAt: 0,
      models: [{ id: "native-anthropic" }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    now = publicCatalogPolicy.ttlMs;
    const damaged = catalog.listModels({ providerKind: "codex" });
    release(Response.json({ ...both(), openai: { models: {} } }));
    expect(await damaged).toMatchObject({
      state: "stale",
      error: "invalid_section",
      fetchedAt: 0,
    });
    expect(await catalog.listModels({ providerKind: "claude" })).toMatchObject({
      state: "fresh",
      error: null,
      fetchedAt: now,
    });
    expect(
      await catalog.listModels({ providerKind: "codex", forceRefresh: true }),
    ).toMatchObject({ refresh: "cooldown", error: "invalid_section" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports failed manual refresh without claiming a new snapshot", async () => {
    let now = 10;
    const fetchImpl = vi.fn(async () => Response.json(both()));
    const catalog = new PublicProviderModelCatalogAdapter({
      fetchImpl,
      now: () => now,
    });
    await catalog.listModels({ providerKind: "codex" });
    fetchImpl.mockRejectedValue(new Error("offline"));
    now = 20;
    expect(
      await catalog.listModels({ providerKind: "codex", forceRefresh: true }),
    ).toMatchObject({
      fetchedAt: 10,
      lastAttemptAt: 20,
      refresh: "failed",
      error: "source_unavailable",
    });
    expect(
      await catalog.listModels({ providerKind: "claude", forceRefresh: true }),
    ).toMatchObject({
      fetchedAt: 10,
      refresh: "cooldown",
      error: "source_unavailable",
    });
  });

  it("honors manual source cooldown, bounds decoded bytes, and expires stale success after 24 hours", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => Response.json(both()));
    const catalog = new PublicProviderModelCatalogAdapter({
      fetchImpl,
      now: () => now,
    });
    expect(await catalog.listModels({ providerKind: "codex" })).toMatchObject({
      state: "fresh",
    });
    expect(
      await catalog.listModels({ providerKind: "codex", forceRefresh: true }),
    ).toMatchObject({ refresh: "updated" });
    expect(
      await catalog.listModels({ providerKind: "claude", forceRefresh: true }),
    ).toMatchObject({ refresh: "cooldown" });
    fetchImpl.mockRejectedValue(new Error("offline"));
    now = publicCatalogPolicy.ttlMs;
    expect(await catalog.listModels({ providerKind: "codex" })).toMatchObject({
      state: "stale",
      error: "source_unavailable",
    });
    now = publicCatalogPolicy.staleMs + 1;
    expect(await catalog.listModels({ providerKind: "codex" })).toMatchObject({
      state: "fallback",
      source: "local",
      fetchedAt: 0,
    });
    const oversized = new PublicProviderModelCatalogAdapter({
      fetchImpl: async () => new Response("123456"),
      policy: { ...publicCatalogPolicy, maxBytes: 5 },
    });
    expect(await oversized.listModels({ providerKind: "codex" })).toMatchObject(
      { state: "fallback", error: "source_unavailable" },
    );
  });
});
