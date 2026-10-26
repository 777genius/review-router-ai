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

export function providerIdentityForKind(
  kind: ProviderKind | undefined,
): ProviderIdentity | undefined {
  switch (kind) {
    case "codex":
      return "openai";
    case "codex-mimo":
      return "mimo";
    case "claude":
      return "anthropic";
    case "openrouter":
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
        provider?: ProviderKind | undefined;
      }>
    | undefined,
): ProviderIdentity | undefined {
  return (
    profile?.connection?.provider ?? providerIdentityForKind(profile?.provider)
  );
}
