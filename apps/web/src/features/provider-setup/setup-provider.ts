import { canCreateConnection } from "../account-gateway/connection-capabilities";
import { nativeAPIProvider } from "../account-gateway/native-api-profiles";
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
export type SetupProviderId = string;

export type SetupProvider = Readonly<{
  id: SetupProviderId;
  label: string;
  identity: ProviderIdentity;
  credentialLabel: string;
  credentialKind: "api_key" | "subscription" | "native";
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
  ...(["anthropic", "gemini"] as const).map(
    (id): SetupProvider => ({
      id,
      label: id === "anthropic" ? "Anthropic API" : "Gemini API",
      identity: id,
      credentialLabel: "API key",
      credentialKind: "api_key",
      githubSource: null,
      publicCatalogProvider: null,
    }),
  ),
  {
    id: "nvidia",
    label: "NVIDIA Build",
    identity: "nvidia",
    credentialLabel: "NVIDIA Build API key",
    credentialKind: "api_key",
    // This is a Gateway-owned connection; never create a direct GitHub Secret.
    githubSource: null,
    publicCatalogProvider: null,
  },
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

export function getSetupProvider(
  id: SetupProviderId,
  native: readonly SetupProvider[] = [],
): SetupProvider {
  const provider =
    native.find((row) => row.id === id) ??
    setupProviders.find((row) => row.id === id);
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
  if (
    source.key === "managed_api_key:claude_code_api_key" ||
    source.key === "user_ci_secret:claude_code_api_key"
  )
    return "claude-code";
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
  if (
    !profile ||
    profile.authKind === "oauth" ||
    profile.connection?.nativeMethods
  )
    return undefined;
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
  if (profile.connection?.nativeMethods)
    return nativeSetupId(profile.connection.provider, profile.id);
  const nativeProvider = nativeAPIProvider(profile.id);
  if (nativeProvider)
    return profile.authKind === "api_key" &&
      profile.connection?.provider === nativeProvider &&
      (!profile.provider || profile.provider === "codex")
      ? nativeProvider
      : undefined;
  if (profile.id === "nvidia-build-chat-apikey-v1")
    return profile.authKind === "api_key" &&
      profile.connection?.provider === "nvidia" &&
      (!profile.provider || profile.provider === "nvidia")
      ? "nvidia"
      : undefined;
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
  // An existing Claude OAuth account may be shown in diagnostic account
  // views, but must not become a new SaaS enrollment/provider choice.
  return undefined;
}

type EnrollableProfile = GatewayProfileIdentity &
  Pick<AccountProfileView, "availability">;

/** The provider a new connection of this profile sets up, if it may be made. */
function enrollableSetupProvider(
  profile: EnrollableProfile,
): SetupProviderId | undefined {
  return canCreateConnection(profile)
    ? setupProviderForGatewayProfile(profile)
    : undefined;
}

/** A profile the provider dialog may connect in place (79). */
export function connectsInProviderDialog(
  profile: EnrollableProfile,
  provider: SetupProviderId,
): boolean {
  return enrollableSetupProvider(profile) === provider;
}

/** Enrollment is advertised independently of an existing account inventory. */
export function gatewaySetupProvidersForProfiles(
  profiles: readonly EnrollableProfile[],
): SetupProviderId[] {
  return [
    ...new Set(
      profiles.flatMap((profile) => {
        const provider = enrollableSetupProvider(profile);
        return provider ? [provider] : [];
      }),
    ),
  ];
}

// Stable display grouping may keep an existing direct source beside native custody.
// It does not grant any native auth method, model, billing mode, or direct execution.
function nativeSetupId(providerId: string, profileId: string): string {
  // Anthropic API keys and Claude Code subscriptions have distinct execution
  // and custody paths, despite sharing the same vendor identity.
  if (nativeAPIProvider(profileId) === "anthropic") return "anthropic";
  return (
    setupProviders.find(
      (row) => row.identity === providerId && row.githubSource !== null,
    )?.id ??
    setupProviders.find((row) => row.identity === providerId)?.id ??
    `native:${providerId}`
  );
}

export function nativeSetupProvidersForProfiles(
  profiles: readonly EnrollableProfile[],
): SetupProvider[] {
  const providers = new Map<string, SetupProvider>();
  for (const profile of profiles) {
    if (!profile.connection?.nativeMethods || !canCreateConnection(profile))
      continue;
    const id = nativeSetupId(profile.connection.provider, profile.id);
    const direct = setupProviders.find((row) => row.id === id);
    providers.set(id, {
      id,
      label: profile.connection.providerLabel ?? profile.connection.provider,
      identity: profile.connection.provider,
      credentialLabel: "Provider credentials",
      credentialKind: direct?.credentialKind ?? "native",
      githubSource: direct?.githubSource ?? null,
      publicCatalogProvider: direct?.publicCatalogProvider ?? null,
    });
  }
  return [...providers.values()];
}

export function setupProviderChoices(
  native: readonly SetupProvider[] = [],
): readonly SetupProvider[] {
  return [
    ...setupProviders.filter(
      (row) =>
        !native.some(
          (item) =>
            item.identity === row.identity &&
            !(row.id === "claude-code" && item.id === "anthropic"),
        ),
    ),
    ...native,
  ];
}

/** Saved direct credentials use their runtime auth mode, including managed keys. */
export function setupProviderForDirectAuthMode(
  authMode: ProviderSourceOption["authMode"],
): SetupProviderId | undefined {
  if (authMode === "codex_subscription_oauth_rotating") return "codex";
  if (authMode === "claude_code_oauth" || authMode === "claude_code_api_key")
    return "claude-code";
  return apiKeyProviderForAuthMode(authMode);
}
