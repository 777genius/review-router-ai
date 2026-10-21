import type {
  ProviderModelCatalogSnapshot,
  PublicCatalogProvider,
} from "@reviewrouter/features-review-providers";

export async function readProviderModelCatalog(input: {
  providerKind: PublicCatalogProvider;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<ProviderModelCatalogSnapshot> {
  const query = new URLSearchParams({ providerKind: input.providerKind });
  if (input.forceRefresh) query.set("refresh", "true");
  const response = await fetch(`/api/provider-model-catalog?${query}`, {
    ...(input.signal ? { signal: input.signal } : {}),
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Public model catalog unavailable.");
  return response.json() as Promise<ProviderModelCatalogSnapshot>;
}
