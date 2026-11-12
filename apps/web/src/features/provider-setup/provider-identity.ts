import {
  providerKindForAuthMode,
  type ProviderAuthMode,
  type ProviderKind,
} from "@reviewrouter/features-review-providers";
import type {
  AccountConnectionView,
  AccountUpstreamProvider,
} from "../account-gateway/connection-capabilities";

/** Display identity only. An engine, model or editable label is not a brand. */
export type ProviderIdentity = AccountUpstreamProvider;

/** One trusted label-to-runtime-kind mapping for configured Gateway API keys.
 * The upstream identity still comes from the account's verified capability;
 * this mapping grants neither model nor credential authority. */
export const gatewayAPIKeyProviderKinds = {
  MiMo: "codex-mimo",
  OpenRouter: "openrouter",
  "NVIDIA Build": "nvidia",
} as const satisfies Readonly<Record<string, ProviderKind | "nvidia">>;

export type GatewayAPIKeyProfileName = keyof typeof gatewayAPIKeyProviderKinds;

export function providerIdentityForKind(
  kind: ProviderKind | "nvidia" | undefined,
): ProviderIdentity | undefined {
  switch (kind) {
    case "codex":
      return "openai";
    case "codex-mimo":
      return "mimo";
    case "claude":
      return "anthropic";
    case "openrouter":
    case "nvidia":
    case "kimi":
      return kind;
    default:
      return undefined;
  }
}

export function providerIdentityForAuthMode(
  authMode: ProviderAuthMode,
): ProviderIdentity | undefined {
  // Gateway's kind is the execution engine, not its upstream provider.
  return authMode === "codex_account_gateway"
    ? undefined
    : providerIdentityForKind(providerKindForAuthMode(authMode));
}

export function accountProviderIdentity(
  profile:
    | Readonly<{
        connection?: AccountConnectionView | undefined;
        provider?: ProviderKind | "nvidia" | undefined;
      }>
    | undefined,
): ProviderIdentity | undefined {
  return (
    profile?.connection?.provider ?? providerIdentityForKind(profile?.provider)
  );
}
