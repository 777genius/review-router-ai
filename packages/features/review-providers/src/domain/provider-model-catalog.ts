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

export function catalogSnapshotOptions(
  snapshot: ProviderModelCatalogSnapshot,
  input: { readonly requiresTools?: boolean } = {},
): readonly ReviewModelOption[] {
  const locals = listStaticReviewModelOptions().filter(
    (option) => option.provider === snapshot.providerKind,
  );
  const localIds = new Set(locals.map((option) => option.value));
  const publicOptions = snapshot.models
    .filter((model) => !localIds.has(model.id))
    .map((model): ReviewModelOption => {
      const unsupported =
        model.textInput === false || model.textOutput === false
          ? "Not a text review model."
          : model.textInput !== true || model.textOutput !== true
            ? "Text capabilities unknown."
            : input.requiresTools !== false && model.toolCalling !== true
              ? "Tool calling support not confirmed."
              : null;
      // Router-owned IDs require explicit runtime support independent of public metadata.
      const reason =
        snapshot.providerKind === "openrouter" &&
        model.id.startsWith("openrouter/") &&
        model.id !== "openrouter/owl-alpha"
          ? "OpenRouter router-owned ids need action runtime support first."
          : unsupported;
      const free = model.pricing?.input === 0 && model.pricing?.output === 0;
      const recommended = [
        "poolside/laguna-m.1:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "openai/gpt-oss-120b:free",
        "openrouter/owl-alpha",
      ].includes(model.id);
      const money = (value: number | null | undefined) =>
        value == null
          ? "unknown"
          : value === 0
            ? "$0"
            : value < 0.01
              ? `$${value.toFixed(4)}`
              : `$${value.toFixed(2)}`;
      const pricing = `${money(model.pricing?.input)}/${money(model.pricing?.output)} per 1M input/output`;
      return {
        value: model.id,
        label: model.name.replace(/\s+\(free\)$/i, ""),
        provider: snapshot.providerKind,
        description: `${model.id} - ${pricing}. ${reason ?? "Public catalog; account access not checked."}`,
        ...(reason
          ? { disabled: true, badge: "Unsupported" as const }
          : snapshot.providerKind === "openrouter" &&
              (free ||
                (model.pricing?.input ?? 0) > 0 ||
                (model.pricing?.output ?? 0) > 0)
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
  const ranks = [
    "openai/gpt-5.3-codex",
    "poolside/laguna-m.1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "openai/gpt-oss-120b:free",
    "openrouter/owl-alpha",
  ];
  if (snapshot.providerKind === "openrouter")
    publicOptions.sort((a, b) => {
      if (!!a.disabled !== !!b.disabled) return a.disabled ? 1 : -1;
      const rank = (id: string) =>
        ranks.indexOf(id) === -1 ? 999 : ranks.indexOf(id);
      const difference = rank(a.value) - rank(b.value);
      if (difference) return difference;
      if (a.badge !== b.badge)
        return a.badge === "FREE" ? -1 : b.badge === "FREE" ? 1 : 0;
      return a.label.localeCompare(b.label);
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
