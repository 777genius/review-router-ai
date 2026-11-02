import type { ProviderKind } from "./provider-catalog";
import {
  listStaticReviewModelOptions,
  type ReviewModelOption,
} from "./provider-models";

export type PublicCatalogProvider = Extract<
  ProviderKind,
  "codex" | "claude" | "openrouter"
>;
export type CatalogCapability = boolean | null;
export type CatalogSelectionOptions = Readonly<{
  requiresTools?: boolean;
  /** Only qualified transports may opt into catalog-admitted routing ids. */
  allowRoutingModels?: boolean;
}>;
export type ProviderCatalogModel = {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number | null;
  readonly textInput: CatalogCapability;
  readonly textOutput: CatalogCapability;
  readonly toolCalling: CatalogCapability;
  readonly pricing: {
    readonly currency: "USD";
    readonly unit: "million_tokens";
    readonly input: number | null;
    readonly output: number | null;
    readonly cacheRead?: number | null;
    readonly cacheWrite?: number | null;
  } | null;
};
export type ProviderModelCatalogSnapshot = {
  readonly providerKind: ProviderKind;
  readonly models: readonly ProviderCatalogModel[];
  readonly source: "models.dev" | "openrouter" | "local";
  readonly fetchedAt: number | null;
  readonly lastAttemptAt: number | null;
  readonly state: "fresh" | "stale" | "fallback" | "unavailable";
  readonly error: "source_unavailable" | "invalid_section" | null;
  readonly refresh: "updated" | "cached" | "cooldown" | "failed";
  readonly skippedModelCount?: number;
};

const recommendedFreeOpenRouterModelIds = [
  "poolside/laguna-m.1:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "openrouter/owl-alpha",
] as const;

export function isFreeCatalogModel(model: ProviderCatalogModel): boolean {
  return (
    model.pricing?.input === 0 &&
    model.pricing.output === 0 &&
    (model.pricing.cacheRead ?? 0) === 0 &&
    (model.pricing.cacheWrite ?? 0) === 0
  );
}

export function catalogModelUnsupportedReason(
  providerKind: ProviderKind,
  model: ProviderCatalogModel,
  input: CatalogSelectionOptions = {},
): string | null {
  if (
    providerKind === "openrouter" &&
    input.allowRoutingModels !== true &&
    model.id.startsWith("openrouter/") &&
    model.id !== "openrouter/owl-alpha"
  )
    return "This OpenRouter routing model is not supported for reviews.";
  if (model.textInput === false || model.textOutput === false)
    return "Not a text review model.";
  if (model.textInput !== true || model.textOutput !== true)
    return "Text capabilities unknown.";
  if (input.requiresTools !== false && model.toolCalling !== true)
    return "Tool calling support not confirmed.";
  return null;
}

function openRouterRecommendationRank(model: ProviderCatalogModel): number {
  if (model.id === "openai/gpt-5.3-codex") return 0;
  const index = recommendedFreeOpenRouterModelIds.indexOf(
    model.id as (typeof recommendedFreeOpenRouterModelIds)[number],
  );
  return index !== -1 && isFreeCatalogModel(model) ? index + 1 : Infinity;
}

/** Shared display policy for public snapshots and the OpenRouter adapter. */
export function compareOpenRouterCatalogModels(
  left: ProviderCatalogModel,
  right: ProviderCatalogModel,
  input: CatalogSelectionOptions = {},
): number {
  const leftUnsupported = catalogModelUnsupportedReason(
    "openrouter",
    left,
    input,
  );
  const rightUnsupported = catalogModelUnsupportedReason(
    "openrouter",
    right,
    input,
  );
  if (Boolean(leftUnsupported) !== Boolean(rightUnsupported))
    return leftUnsupported ? 1 : -1;
  const leftRank = leftUnsupported
    ? Infinity
    : openRouterRecommendationRank(left);
  const rightRank = rightUnsupported
    ? Infinity
    : openRouterRecommendationRank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  if (isFreeCatalogModel(left) !== isFreeCatalogModel(right))
    return isFreeCatalogModel(left) ? -1 : 1;
  const totalPrice = (model: ProviderCatalogModel) =>
    (model.pricing?.input ?? Infinity) + (model.pricing?.output ?? Infinity);
  const leftPrice = totalPrice(left);
  const rightPrice = totalPrice(right);
  if (leftPrice !== rightPrice) return leftPrice < rightPrice ? -1 : 1;
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export function catalogSnapshotOptions(
  snapshot: ProviderModelCatalogSnapshot,
  input: CatalogSelectionOptions = {},
): readonly ReviewModelOption[] {
  const locals = listStaticReviewModelOptions().filter(
    (option) => option.provider === snapshot.providerKind,
  );
  const localIds = new Set(locals.map((option) => option.value));
  const models = snapshot.models.filter((model) => !localIds.has(model.id));
  if (snapshot.providerKind === "openrouter")
    models.sort((left, right) =>
      compareOpenRouterCatalogModels(left, right, input),
    );
  const publicOptions = models.map((model): ReviewModelOption => {
    const reason = catalogModelUnsupportedReason(
      snapshot.providerKind,
      model,
      input,
    );
    const free = isFreeCatalogModel(model);
    const recommended = openRouterRecommendationRank(model) < Infinity;
    const money = (value: number | null | undefined) =>
      value == null
        ? "unknown"
        : value === 0
          ? "$0"
          : value < 0.01
            ? `$${value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 4 })}`
            : `$${value.toFixed(2)}`;
    const pricing = `${money(model.pricing?.input)}/${money(model.pricing?.output)} per 1M input/output${model.pricing?.cacheRead != null ? `; ${money(model.pricing.cacheRead)} per 1M cache read` : ""}${model.pricing?.cacheWrite != null ? `; ${money(model.pricing.cacheWrite)} per 1M cache write` : ""}`;
    const context =
      model.contextTokens === null
        ? "Context unknown"
        : `${model.contextTokens.toLocaleString("en-US")} token context`;
    const provenance =
      snapshot.source === "local"
        ? "Built-in fallback; public metadata unavailable."
        : snapshot.state === "stale"
          ? "Cached public catalog; account access not checked."
          : "Public catalog; account access not checked.";
    const metadataDescription = `${model.id} - ${pricing}. ${context}. ${provenance}`;
    return {
      value: model.id,
      label: model.name.replace(/\s+\(free\)$/i, ""),
      provider: snapshot.providerKind,
      metadataDescription,
      description: `${metadataDescription}${reason ? ` ${reason}` : ""}`,
      ...(reason
        ? { disabled: true, badge: "Unsupported" as const }
        : snapshot.providerKind === "openrouter" &&
            (free ||
              (model.pricing?.input ?? 0) > 0 ||
              (model.pricing?.output ?? 0) > 0 ||
              (model.pricing?.cacheRead ?? 0) > 0 ||
              (model.pricing?.cacheWrite ?? 0) > 0)
          ? {
              badge: free
                ? recommended
                  ? ("FREE RECOMMENDED" as const)
                  : ("FREE" as const)
                : ("PAID" as const),
            }
          : {}),
    };
  });
  return [...locals, ...publicOptions];
}

export function localCatalogModels(
  providerKind: ProviderKind,
): readonly ProviderCatalogModel[] {
  const options =
    providerKind === "openrouter"
      ? [
          { value: "openai/gpt-5.3-codex", label: "OpenAI: GPT-5.3 Codex" },
          { value: "poolside/laguna-m.1:free", label: "Poolside: Laguna M.1" },
          {
            value: "nvidia/nemotron-3-super-120b-a12b:free",
            label: "NVIDIA: Nemotron 3 Super",
          },
          { value: "openai/gpt-oss-120b:free", label: "OpenAI: gpt-oss-120b" },
          { value: "openrouter/owl-alpha", label: "Owl Alpha" },
          {
            value: "minimax/minimax-m2.5:free",
            label: "MiniMax: MiniMax M2.5",
          },
          { value: "z-ai/glm-4.5-air:free", label: "Z.ai: GLM 4.5 Air" },
        ]
      : listStaticReviewModelOptions().filter(
          (option) => option.provider === providerKind,
        );
  return options.map((option) => ({
    id: option.value,
    name: option.label,
    contextTokens: null,
    textInput: true,
    textOutput: true,
    toolCalling: true,
    pricing: null,
  }));
}
