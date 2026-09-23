import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterModelCatalogAdapter } from "./openrouter-model-catalog";

const response = (id: string) =>
  Response.json({
    data: [
      {
        id,
        name: id,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["text"],
        },
      },
    ],
  });

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter default catalog cache", () => {
  it("single-flights concurrent fetches and refreshes after the 30-minute TTL", async () => {
    let now = 0;
    let resolveFetch!: (value: Response) => void;
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const catalog = new OpenRouterModelCatalogAdapter({ now: () => now });

    const first = catalog.getOpenRouterCatalog();
    const second = catalog.getOpenRouterCatalog();
    expect(fetchSpy).toHaveBeenCalledOnce();
    resolveFetch(response("vendor/first"));
    expect((await first)[0]?.id).toBe("vendor/first");
    expect((await second)[0]?.id).toBe("vendor/first");
    now = 30 * 60 * 1000 - 1;
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe("vendor/first");
    expect(fetchSpy).toHaveBeenCalledOnce();

    now += 1;
    const refreshed = catalog.getOpenRouterCatalog();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    resolveFetch(response("vendor/second"));
    expect((await refreshed)[0]?.id).toBe("vendor/second");
  });

  it("returns stale success through a short failure cooldown", async () => {
    let now = 0;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(response("vendor/healthy"))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(response("vendor/recovered"));
    vi.stubGlobal("fetch", fetchSpy);
    const catalog = new OpenRouterModelCatalogAdapter({ now: () => now });

    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/healthy",
    );
    now = 30 * 60 * 1000;
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/healthy",
    );
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/healthy",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    now += 5 * 60 * 1000;
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/recovered",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("uses fallback during an initial failure and keeps injected fetches isolated", async () => {
    const defaultFetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", defaultFetch);
    let now = 0;
    const defaultCatalog = new OpenRouterModelCatalogAdapter({
      now: () => now,
    });
    const fallback = await defaultCatalog.getOpenRouterCatalog();
    expect(fallback.length).toBeGreaterThan(0);
    expect(await defaultCatalog.getOpenRouterCatalog()).toEqual(fallback);
    expect(defaultFetch).toHaveBeenCalledOnce();

    const injectedFetch = vi.fn(async () => response("vendor/injected"));
    const injectedCatalog = new OpenRouterModelCatalogAdapter({
      fetchImpl: injectedFetch,
      now: () => now,
    });
    expect((await injectedCatalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/injected",
    );
    expect((await injectedCatalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/injected",
    );
    expect(injectedFetch).toHaveBeenCalledTimes(2);
    now += 5 * 60 * 1000;
    expect(defaultFetch).toHaveBeenCalledOnce();
  });

  it("caches a successful default fetch made with an abort signal", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response("vendor/signaled"));
    vi.stubGlobal("fetch", fetchSpy);
    const catalog = new OpenRouterModelCatalogAdapter({});

    expect(
      (await catalog.getOpenRouterCatalog(new AbortController().signal))[0]?.id,
    ).toBe("vendor/signaled");
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/signaled",
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("cools down failed signal-bound fetches unless the caller aborted", async () => {
    let now = 0;
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(response("vendor/recovered"));
    vi.stubGlobal("fetch", fetchSpy);
    const catalog = new OpenRouterModelCatalogAdapter({ now: () => now });

    const fallback = await catalog.getOpenRouterCatalog(
      new AbortController().signal,
    );
    expect(fallback.length).toBeGreaterThan(0);
    expect(await catalog.getOpenRouterCatalog()).toEqual(fallback);
    expect(fetchSpy).toHaveBeenCalledOnce();

    now += 5 * 60 * 1000;
    expect((await catalog.getOpenRouterCatalog())[0]?.id).toBe(
      "vendor/recovered",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
