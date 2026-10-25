/** Safe connection metadata. Upstream identity is independent of the review engine. */
export type AccountUpstreamProvider =
  | "mimo"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "kimi"
  | "glm"
  | "minimax"
  | "grok";

export type AccountModelSettings = {
  modelId: string;
  reasoning: { allowed: readonly string[]; default: string } | null;
  fast: { allowed: readonly string[]; default: string } | null;
  tools: {
    allowed: readonly ("none" | "function" | "function_and_custom")[];
    default: "none" | "function" | "function_and_custom";
  };
};

export type AccountConnectionView = {
  provider: AccountUpstreamProvider;
  planLabel: string;
  regionLabel: string;
  completionInputKind: "none" | "callback_url" | "authorization_code";
  personalOnly: boolean;
  limitsContract: "account-limits/v1" | "account-limits/v2" | "none";
  modelSettings: readonly AccountModelSettings[];
};

/** Account-scoped discovery metadata; never contains Gateway identity/fences. */
export type AccountModelCatalogView = {
  status: "snapshot" | "unsupported" | "unavailable" | "unknown";
  source: "codex" | "legacy_profile";
  fetchedAt?: string;
  expiresAt?: string;
  models: readonly string[];
};
