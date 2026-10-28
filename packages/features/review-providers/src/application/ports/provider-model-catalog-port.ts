import type { ProviderKind } from "../../domain/provider-catalog";
import type { ProviderModelCatalogSnapshot } from "../../domain/provider-model-catalog";
export interface ProviderModelCatalogPort {
  listModels(input: {
    readonly providerKind: ProviderKind;
    readonly signal?: AbortSignal;
    readonly forceRefresh?: boolean;
  }): Promise<ProviderModelCatalogSnapshot>;
}
