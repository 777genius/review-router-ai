import { defaultCodexModel, type ProviderKind } from "./provider-catalog";

export type ReviewModelOption = {
  readonly value: string;
  readonly label: string;
  readonly provider: ProviderKind;
  readonly description?: string;
  /** Catalog facts only, without transport/capability refusal text. */
  readonly metadataDescription?: string;
  readonly badge?: "FREE RECOMMENDED" | "FREE" | "PAID" | "Unsupported";
  readonly disabled?: boolean;
};

export type CodexReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

/** The legacy selection stays stored; only this Gateway profile uses wire Max. */
export function effectiveGatewayReasoningEffort(
  profileRef: string | undefined,
  effort: string | undefined,
): string | undefined {
  return profileRef === "openai-codex-oauth-responses-v1" && effort === "ultra"
    ? "max"
    : effort;
}

export function codexModelSupportsReasoningEffort(
  model: string,
  effort: CodexReasoningEffort,
): boolean {
  return (
    effort !== "minimal" &&
    ((effort !== "max" && effort !== "ultra") ||
      model.trim() === defaultCodexModel)
  );
}

export const codexModelOptions: readonly ReviewModelOption[] = [
  {
    value: defaultCodexModel,
    label: defaultCodexModel,
    provider: "codex",
    description: "Codex default model.",
  },
  {
    value: "gpt-5.5",
    label: "gpt-5.5",
    provider: "codex",
    description: "Codex model.",
  },
  {
    value: "gpt-5.4",
    label: "gpt-5.4",
    provider: "codex",
    description: "Codex model.",
  },
  {
    value: "gpt-5.4-mini",
    label: "gpt-5.4-mini",
    provider: "codex",
    description: "Lower-latency Codex model.",
  },
  {
    value: "gpt-5.3-codex",
    label: "gpt-5.3-codex",
    provider: "codex",
    description: "Codex-specialized model.",
  },
  {
    value: "gpt-5.3-codex-spark",
    label: "gpt-5.3-codex-spark",
    provider: "codex",
    description: "Fast Codex-specialized model.",
  },
  {
    value: "gpt-5.2",
    label: "gpt-5.2",
    provider: "codex",
    description: "Codex model.",
  },
];

/** Retain the existing reviewed model policy; public metadata cannot enable fast mode. */
export function codexModelSupportsFastMode(model: string): boolean {
  return codexModelOptions.some((option) => option.value === model.trim());
}

export const claudeModelOptions: readonly ReviewModelOption[] = [
  {
    value: "sonnet",
    label: "sonnet",
    provider: "claude",
    description: "Claude Code default model.",
  },
  {
    value: "opus",
    label: "opus",
    provider: "claude",
    description: "Claude Code model.",
  },
  {
    value: "haiku",
    label: "haiku",
    provider: "claude",
    description: "Lower-latency Claude Code model.",
  },
];

export const mimoModelOptions: readonly ReviewModelOption[] = [
  {
    value: "mimo-v2.6-pro",
    label: "mimo-v2.6-pro",
    provider: "codex-mimo",
    description: "MiMo Token Plan public engine model.",
  },
];

export const kimiModelOptions: readonly ReviewModelOption[] = [
  {
    value: "k3-256k",
    label: "k3-256k",
    provider: "kimi",
    description: "Kimi Code model.",
  },
];

export function listStaticReviewModelOptions(): readonly ReviewModelOption[] {
  return [
    ...codexModelOptions,
    ...mimoModelOptions,
    ...kimiModelOptions,
    ...claudeModelOptions,
  ];
}
