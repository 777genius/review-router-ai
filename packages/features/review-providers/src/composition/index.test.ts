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
});
