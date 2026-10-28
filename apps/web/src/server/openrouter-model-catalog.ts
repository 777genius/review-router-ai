import { createProviderModelCatalog } from "@reviewrouter/features-review-providers/composition";
import {
  fetchOpenRouterCatalog,
  listReviewModelOptions,
  normalizeOpenRouterModelsResponse,
  OpenRouterModelCatalogAdapter,
  publicCatalogPolicy,
  type ProviderKind,
  type ProviderModelCatalogSnapshot,
  type OpenRouterCatalogModel,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";

export type {
  OpenRouterCatalogModel,
  ReviewModelOption,
  ProviderModelCatalogSnapshot,
};
export { fetchOpenRouterCatalog, normalizeOpenRouterModelsResponse };
let defaultModelCatalog:
  | ReturnType<typeof createProviderModelCatalog>
  | undefined;
function getDefaultModelCatalog() {
  return (defaultModelCatalog ??= createProviderModelCatalog({
    fetchImpl: (url, init) => fetch(url, init),
    now: Date.now,
    policy: publicCatalogPolicy,
  }));
}
export async function getProviderModelCatalog(input: {
  readonly providerKind: ProviderKind;
  readonly forceRefresh?: boolean;
  readonly signal?: AbortSignal;
}): Promise<ProviderModelCatalogSnapshot> {
  return (await getDefaultModelCatalog()).listModels(input);
}
export async function getProviderModelCatalogs(): Promise<
  readonly ProviderModelCatalogSnapshot[]
> {
  return Promise.all(
    (["codex", "claude", "openrouter"] as const).map((providerKind) =>
      getProviderModelCatalog({ providerKind }),
    ),
  );
}
export async function getReviewModelOptions(input?: {
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
}): Promise<readonly ReviewModelOption[]> {
  const modelCatalog =
    input?.fetchImpl || input?.now !== undefined
      ? new OpenRouterModelCatalogAdapter({
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          ...(input.now !== undefined ? { now: () => input.now! } : {}),
        })
      : await getDefaultModelCatalog();
  return listReviewModelOptions({ modelCatalog });
}
export async function getOpenRouterCatalog(input?: {
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
}): Promise<readonly OpenRouterCatalogModel[]> {
  const modelCatalog =
    input?.fetchImpl || input?.now !== undefined
      ? new OpenRouterModelCatalogAdapter({
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
          ...(input.now !== undefined ? { now: () => input.now! } : {}),
        })
      : await getDefaultModelCatalog();
  return modelCatalog.getOpenRouterCatalog();
}
