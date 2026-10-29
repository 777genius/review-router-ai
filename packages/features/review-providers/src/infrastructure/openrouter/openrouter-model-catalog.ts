import {
  compareOpenRouterCatalogModels,
  isFreeCatalogModel,
  type ProviderCatalogModel,
} from "../../domain/provider-model-catalog";
import {
  PublicProviderModelCatalogAdapter,
  fetchPublicCatalog,
  normalizePublicCatalog,
} from "../catalog/public-model-catalog";

export type OpenRouterCatalogModel = {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number | null;
  readonly promptUsdPer1M: number | null;
  readonly completionUsdPer1M: number | null;
  readonly isFree: boolean;
  readonly supportsReviewText: boolean;
};

export class OpenRouterModelCatalogAdapter extends PublicProviderModelCatalogAdapter {
  async getOpenRouterCatalog(
    signal?: AbortSignal,
  ): Promise<readonly OpenRouterCatalogModel[]> {
    const snapshot = await this.listModels({
      providerKind: "openrouter",
      ...(signal ? { signal } : {}),
    });
    return openRouterCatalogModels(snapshot.models);
  }
}

export async function fetchOpenRouterCatalog(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<readonly OpenRouterCatalogModel[]> {
  signal?.throwIfAborted();
  const raw = await fetchPublicCatalog(
    "https://openrouter.ai/api/v1/models",
    fetchImpl,
  );
  signal?.throwIfAborted();
  return normalizeOpenRouterModelsResponse(raw);
}

export function normalizeOpenRouterModelsResponse(
  response: unknown,
): readonly OpenRouterCatalogModel[] {
  return openRouterCatalogModels(
    normalizePublicCatalog(response, "openrouter"),
  );
}

function openRouterCatalogModels(
  models: readonly ProviderCatalogModel[],
): readonly OpenRouterCatalogModel[] {
  return (
    [...models]
      // This projection reports text support; engine-specific tool requirements
      // are applied by catalogSnapshotOptions against the complete snapshot.
      .sort((left, right) =>
        compareOpenRouterCatalogModels(left, right, { requiresTools: false }),
      )
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextTokens: model.contextTokens,
        promptUsdPer1M: model.pricing?.input ?? null,
        completionUsdPer1M: model.pricing?.output ?? null,
        isFree: isFreeCatalogModel(model),
        supportsReviewText:
          model.textInput === true && model.textOutput === true,
      }))
  );
}
