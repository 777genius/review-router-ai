import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createProviderModelCatalog } from "./index";
import { publicCatalogPolicy } from "../infrastructure/catalog/public-model-catalog";

describe("server catalog composition", () => {
  it("constructs a working catalog through typed bindings without fetching before use", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "vendor/model",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            supported_parameters: ["tools"],
          },
        ],
      }),
    );
    const catalog = await createProviderModelCatalog({
      fetchImpl,
      now: () => 7,
      policy: publicCatalogPolicy,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await catalog.listModels({ providerKind: "openrouter" }),
    ).toMatchObject({
      fetchedAt: 7,
      state: "fresh",
      models: [{ id: "vendor/model" }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("rejects invalid dependency bindings before I/O", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createProviderModelCatalog({
        fetchImpl,
        now: () => 0,
        policy: { ...publicCatalogPolicy, timeoutMs: 0 },
      }),
    ).rejects.toThrow("catalog_composition_binding_invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps host transport, clock, policy and cache isolated over real HTTP", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            {
              id: `vendor${request.url}`,
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              supported_parameters: ["tools"],
            },
          ],
        }),
      );
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("catalog_fixture_address_unavailable");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      let firstNow = 7;
      let secondNow = 17;
      const [first, second] = await Promise.all([
        createProviderModelCatalog({
          fetchImpl: (url, init) => {
            expect(url).toBe("https://openrouter.ai/api/v1/models");
            return fetch(`${origin}/first`, init);
          },
          now: () => firstNow,
          policy: { ...publicCatalogPolicy, ttlMs: 10 },
        }),
        createProviderModelCatalog({
          fetchImpl: (url, init) => {
            expect(url).toBe("https://openrouter.ai/api/v1/models");
            return fetch(`${origin}/second`, init);
          },
          now: () => secondNow,
          policy: { ...publicCatalogPolicy, ttlMs: 100 },
        }),
      ]);
      expect(requests).toEqual([]);
      expect(
        await first.listModels({ providerKind: "openrouter" }),
      ).toMatchObject({ fetchedAt: 7, models: [{ id: "vendor/first" }] });
      expect(
        await second.listModels({ providerKind: "openrouter" }),
      ).toMatchObject({ fetchedAt: 17, models: [{ id: "vendor/second" }] });

      firstNow = 18;
      secondNow = 28;
      expect(
        await first.listModels({ providerKind: "openrouter" }),
      ).toMatchObject({ fetchedAt: 18, state: "fresh", refresh: "updated" });
      expect(await second.getOpenRouterCatalog()).toMatchObject([
        { id: "vendor/second", supportsReviewText: true },
      ]);
      expect(requests).toEqual(["/first", "/second", "/first"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
