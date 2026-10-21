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
const openRouterModelsUrl = "https://openrouter.ai/api/v1/models";
const recommendedCodexAgentOpenRouterModelIds = [
  "openai/gpt-5.3-codex",
] as const;
const recommendedFreeOpenRouterModelIds = [
  "poolside/laguna-m.1:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "openrouter/owl-alpha",
] as const;
const supportedOpenRouterOwnedModelIds = new Set<string>([
  "openrouter/owl-alpha",
]);
export class OpenRouterModelCatalogAdapter extends PublicProviderModelCatalogAdapter {
  async getOpenRouterCatalog(
    signal?: AbortSignal,
  ): Promise<readonly OpenRouterCatalogModel[]> {
    const snapshot = await this.listModels({
      providerKind: "openrouter",
      ...(signal ? { signal } : {}),
    });
    return snapshot.models
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextTokens: model.contextTokens,
        promptUsdPer1M: model.pricing?.input ?? null,
        completionUsdPer1M: model.pricing?.output ?? null,
        isFree: model.pricing?.input === 0 && model.pricing?.output === 0,
        supportsReviewText:
          model.textInput === true && model.textOutput === true,
      }))
      .sort(compareOpenRouterCatalogModels);
  }
}

export async function fetchOpenRouterCatalog(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<readonly OpenRouterCatalogModel[]> {
  signal?.throwIfAborted();
  const raw = await fetchPublicCatalog(openRouterModelsUrl, fetchImpl);
  signal?.throwIfAborted();
  return normalizeOpenRouterModelsResponse(raw);
}

export function normalizeOpenRouterModelsResponse(
  response: unknown,
): readonly OpenRouterCatalogModel[] {
  return normalizePublicCatalog(response, "openrouter")
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextTokens: model.contextTokens,
      promptUsdPer1M: model.pricing?.input ?? null,
      completionUsdPer1M: model.pricing?.output ?? null,
      isFree: model.pricing?.input === 0 && model.pricing?.output === 0,
      supportsReviewText: model.textInput === true && model.textOutput === true,
    }))
    .sort(compareOpenRouterCatalogModels);
}
function compareOpenRouterCatalogModels(
  left: OpenRouterCatalogModel,
  right: OpenRouterCatalogModel,
): number {
  const leftUnsupported = isUnsupportedOpenRouterModel(left);
  const rightUnsupported = isUnsupportedOpenRouterModel(right);
  if (leftUnsupported !== rightUnsupported) {
    return leftUnsupported ? 1 : -1;
  }

  const leftCodexAgentRank = getRecommendedCodexAgentOpenRouterModelRank(left);
  const rightCodexAgentRank =
    getRecommendedCodexAgentOpenRouterModelRank(right);
  if (leftCodexAgentRank !== rightCodexAgentRank) {
    if (leftCodexAgentRank === null) {
      return 1;
    }
    if (rightCodexAgentRank === null) {
      return -1;
    }
    return leftCodexAgentRank - rightCodexAgentRank;
  }

  const leftRecommendedRank = getRecommendedFreeOpenRouterModelRank(left);
  const rightRecommendedRank = getRecommendedFreeOpenRouterModelRank(right);
  if (leftRecommendedRank !== rightRecommendedRank) {
    if (leftRecommendedRank === null) {
      return 1;
    }
    if (rightRecommendedRank === null) {
      return -1;
    }
    return leftRecommendedRank - rightRecommendedRank;
  }

  if (left.isFree !== right.isFree) {
    return left.isFree ? -1 : 1;
  }

  const leftPrice =
    (left.promptUsdPer1M ?? Number.POSITIVE_INFINITY) +
    (left.completionUsdPer1M ?? Number.POSITIVE_INFINITY);
  const rightPrice =
    (right.promptUsdPer1M ?? Number.POSITIVE_INFINITY) +
    (right.completionUsdPer1M ?? Number.POSITIVE_INFINITY);

  if (leftPrice !== rightPrice) {
    return leftPrice - rightPrice;
  }

  return left.name.localeCompare(right.name);
}

function getUnsupportedReason(model: OpenRouterCatalogModel): string | null {
  if (!model.supportsReviewText) {
    return "Not a text review model.";
  }
  if (
    model.id.startsWith("openrouter/") &&
    !supportedOpenRouterOwnedModelIds.has(model.id)
  ) {
    return "OpenRouter router-owned ids need action runtime support first.";
  }
  return null;
}

function isUnsupportedOpenRouterModel(model: OpenRouterCatalogModel): boolean {
  return getUnsupportedReason(model) !== null;
}

function getRecommendedCodexAgentOpenRouterModelRank(
  model: OpenRouterCatalogModel,
): number | null {
  if (isUnsupportedOpenRouterModel(model)) {
    return null;
  }

  const index = recommendedCodexAgentOpenRouterModelIds.indexOf(
    model.id as (typeof recommendedCodexAgentOpenRouterModelIds)[number],
  );
  return index === -1 ? null : index;
}

function getRecommendedFreeOpenRouterModelRank(
  model: OpenRouterCatalogModel,
): number | null {
  if (!model.isFree || isUnsupportedOpenRouterModel(model)) {
    return null;
  }

  const index = recommendedFreeOpenRouterModelIds.indexOf(
    model.id as (typeof recommendedFreeOpenRouterModelIds)[number],
  );
  return index === -1 ? null : index;
}
