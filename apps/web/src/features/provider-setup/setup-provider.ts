import {
  apiKeyProviders,
  apiKeyProviderForAuthMode,
  type ApiKeyProviderId,
  type ProviderKind,
} from "@reviewrouter/features-review-providers";
import type { AccountProfileView } from "../../server/account-gateway-accounts";
import type {
  ProviderSourceKey,
  ProviderSourceOption,
} from "./provider-setup-model";
import type { ProviderIdentity } from "./provider-identity";
import { subscriptionProfileDefinition } from "../account-gateway/subscription-profiles";

/** Provider identity and credential custody are separate choices in setup. */
export type SetupProviderId =
  | ApiKeyProviderId
  | "codex"
  | "claude-code"
  | "glm"
  | "minimax"
  | "grok";

export type SetupProvider = Readonly<{
  id: SetupProviderId;
  label: string;
  identity: ProviderIdentity;
  credentialLabel: string;
  credentialKind: "api_key" | "subscription";
  githubSource: ProviderSourceKey | null;
  publicCatalogProvider: ProviderKind | null;
}>;

export const setupProviders: readonly SetupProvider[] = Object.freeze([
  {
    id: "codex",
    label: "Codex",
    identity: "openai",
    credentialLabel: "Codex session (auth.json)",
    credentialKind: "subscription",
    githubSource: "repository_rotating",
    publicCatalogProvider: "codex",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    identity: "anthropic",
    credentialLabel: "Claude Code subscription",
    credentialKind: "subscription",
    githubSource: "user_ci_secret:claude_code_oauth",
    publicCatalogProvider: "claude",
  },
  ...apiKeyProviders.map(
    (provider): SetupProvider => ({
      id: provider.id,
      label: provider.label,
      identity: provider.gatewayUpstreamProvider,
      credentialLabel: "API key",
      credentialKind: "api_key",
      githubSource: `user_ci_secret:${provider.directAuthMode}`,
      publicCatalogProvider: provider.directProviderKind,
    }),
  ),
  {
    id: "glm",
    label: "GLM Coding Plan",
    identity: "glm",
    credentialLabel: "GLM Coding Plan key",
    credentialKind: "subscription",
    githubSource: null,
    publicCatalogProvider: null,
  },
  {
    id: "minimax",
    label: "MiniMax M Plan",
    identity: "minimax",
    credentialLabel: "MiniMax M Plan key",
    credentialKind: "subscription",
    githubSource: null,
    publicCatalogProvider: null,
  },
  {
    id: "grok",
    label: "Grok",
    identity: "grok",
    credentialLabel: "Grok subscription",
    credentialKind: "subscription",
    githubSource: null,
    publicCatalogProvider: null,
  },
]);

export function getSetupProvider(id: SetupProviderId): SetupProvider {
  const provider = setupProviders.find((row) => row.id === id);
  if (!provider) throw new Error("unknown_setup_provider");
  return provider;
}

/** A direct source has a provider identity; the generic Gateway source has none. */
export function setupProviderForSource(
  source: Pick<ProviderSourceOption, "key">,
): SetupProviderId | undefined {
  const direct = setupProviders.find(
    (provider) => provider.githubSource === source.key,
  );
  if (direct) return direct.id;
  if (source.key.startsWith("managed_api_key:"))
    return apiKeyProviders.find(
      (provider) => source.key === `managed_api_key:${provider.directAuthMode}`,
    )?.id;
  return undefined;
}

type GatewayProfileIdentity = Pick<
  AccountProfileView,
  "id" | "connection" | "provider" | "authKind" | "protocol"
>;

/** Safe server-issued identity, never an editable connection label or model. */
export function apiKeyProviderForGatewayProfile(
  profile:
    | Pick<AccountProfileView, "connection" | "provider" | "authKind">
    | undefined,
): ApiKeyProviderId | undefined {
  if (!profile || profile.authKind === "oauth") return undefined;
  return apiKeyProviders.find((provider) =>
    profile.connection
      ? profile.connection.provider === provider.gatewayUpstreamProvider
      : profile.provider === provider.directProviderKind,
  )?.id;
}

/**
 * Subscription enrollment is limited to the configured Gateway profiles.
 * An advertised upstream vendor alone does not grant a new auth contract.
 */
export function setupProviderForGatewayProfile(
  profile: GatewayProfileIdentity | undefined,
): SetupProviderId | undefined {
  if (!profile || profile.protocol !== "openai-responses") return undefined;
  const subscription = subscriptionProfileDefinition(profile.id);
  if (
    subscription &&
    subscription.provider !== "kimi" &&
    profile.authKind === subscription.authKind &&
    profile.connection?.provider === subscription.provider &&
    (!profile.provider || profile.provider === "codex")
  )
    return subscription.provider;
  if (profile.authKind !== "oauth")
    return apiKeyProviderForGatewayProfile(profile);
  if (
    profile.id === "openai-codex-oauth-responses-v1" &&
    (!profile.connection || profile.connection.provider === "openai") &&
    (!profile.provider || profile.provider === "codex")
  )
    return "codex";
  if (
    profile.id === "anthropic-claude-oauth-messages-v1" &&
    (!profile.connection || profile.connection.provider === "anthropic") &&
    (!profile.provider || profile.provider === "claude")
  )
    return "claude-code";
  return undefined;
}

/** Enrollment is advertised independently of an existing account inventory. */
export function gatewaySetupProvidersForProfiles(
  profiles: readonly (GatewayProfileIdentity &
    Pick<AccountProfileView, "availability">)[],
): SetupProviderId[] {
  return [
    ...new Set(
      profiles.flatMap((profile) => {
        if (profile.availability === "deployment_configuration_required")
          return [];
        const provider = setupProviderForGatewayProfile(profile);
        return provider ? [provider] : [];
      }),
    ),
  ];
}

/** Saved direct credentials use their runtime auth mode, including managed keys. */
export function setupProviderForDirectAuthMode(
  authMode: ProviderSourceOption["authMode"],
): SetupProviderId | undefined {
  if (authMode === "codex_subscription_oauth_rotating") return "codex";
  if (authMode === "claude_code_oauth") return "claude-code";
  return apiKeyProviderForAuthMode(authMode);
}
