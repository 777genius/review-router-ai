import { accountProviderIdentity } from "../features/provider-setup/provider-identity";
import * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import { isPersonalOwnerOnlyProfile } from "@reviewrouter/features-provider-accounts";
import type { AccountProfileView } from "./account-gateway-accounts";
import {
  subscriptionProfileDefinition,
  subscriptionProfileProviders,
} from "../features/account-gateway/subscription-profiles";
export { subscriptionProfileProviders } from "../features/account-gateway/subscription-profiles";
export function configuredSubscriptionProfiles(
  raw: string | undefined,
): string[] {
  const profiles = raw?.trim()
    ? raw.split(",").map((value) => value.trim())
    : [];
  if (
    new Set(profiles).size !== profiles.length ||
    profiles.some((id) => !Object.hasOwn(subscriptionProfileProviders, id))
  )
    throw new Error("accounts_unavailable");
  return profiles;
}

/** Project the qualified deployment catalog; this read has no provider effects. */
export async function connectionProfiles(input: {
  legacy: readonly AccountProfileView[];
  /** Omit when enriching an already authorized review catalog. */
  subscriptionProfileIds?: readonly string[];
  capabilities?: () => Promise<c.ProviderConnectionCapabilities>;
}): Promise<AccountProfileView[]> {
  let capabilities: c.ProviderConnectionCapabilities["capabilities"] = [];
  try {
    if (input.capabilities)
      capabilities = c.providerConnectionCapabilities.parse(
        await input.capabilities(),
      ).capabilities;
  } catch (error) {
    // Only an absent endpoint permits the legacy catalog. Authorization and malformed
    // responses must fail closed. New profiles are never synthesized on fallback.
    if (
      !(
        error instanceof GatewayError &&
        (error as GatewayError & { httpStatus?: number }).httpStatus === 404
      )
    )
      throw error;
  }
  const byId = new Map(capabilities.map((row) => [row.profileId, row]));
  if (byId.size !== capabilities.length)
    throw new Error("accounts_unavailable");
  const result = input.legacy.map((legacy) => {
    const wire = byId.get(legacy.id);
    if (!wire) return legacy;
    const provider = accountProviderIdentity(legacy);
    if (
      wire.protocol !== legacy.protocol ||
      (provider !== undefined && wire.provider.identity !== provider) ||
      (legacy.authKind === "api_key" &&
        !wire.authMethods.includes("api_key")) ||
      (legacy.authKind === "oauth" &&
        !wire.authMethods.some((method) => method.startsWith("oauth_")))
    )
      throw new Error("accounts_unavailable");
    const models = legacy.models.filter((model) =>
      wire.modelIds.includes(model),
    );
    const connection = connectionView(wire);
    return {
      ...legacy,
      availability:
        legacy.availability === "deployment_configuration_required"
          ? legacy.availability
          : wire.availability,
      models,
      connection: {
        ...connection,
        modelSettings: connection.modelSettings.filter((model) =>
          models.includes(model.modelId),
        ),
      },
    };
  });
  if (input.subscriptionProfileIds === undefined) return result;
  for (const id of Object.keys(subscriptionProfileProviders)) {
    const wire = byId.get(id);
    const definition = subscriptionProfileDefinition(id)!;
    const provider = definition.provider;
    if (
      !wire ||
      wire.provider.identity !== provider ||
      wire.region.identity !== "global" ||
      wire.protocol !== "openai-responses"
    )
      continue;
    const oauth = definition.authKind === "oauth";
    if (
      !wire.authMethods.includes(oauth ? "oauth_authorization_code" : "api_key")
    )
      continue;
    result.push({
      id,
      label: wire.provider.label,
      provider: "codex",
      protocol: wire.protocol,
      availability: input.subscriptionProfileIds.includes(id)
        ? wire.availability
        : "deployment_configuration_required",
      models: [...wire.modelIds],
      authKind: oauth ? "oauth" : "api_key",
      canReconnect: wire.reconnect !== "none",
      ...(oauth ? { oauthMethods: ["browser"] as const } : {}),
      connection: connectionView(wire),
    });
  }
  return result;
}
function connectionView(
  wire: c.ProviderConnectionCapability,
): NonNullable<AccountProfileView["connection"]> {
  return {
    provider: wire.provider.identity,
    planLabel: wire.plan.label,
    regionLabel: wire.region.label,
    completionInputKind: wire.completionInputKind,
    personalOnly: isPersonalOwnerOnlyProfile(wire.profileId),
    limitsContract: wire.limitsContract,
    modelSettings: wire.models,
  };
}
export function operationCompletion(
  profile: Pick<AccountProfileView, "id" | "label" | "connection" | "provider">,
) {
  const inputKind =
    profile.connection?.completionInputKind ??
    (profile.id === "anthropic-claude-oauth-messages-v1"
      ? "authorization_code"
      : profile.id === "openai-codex-oauth-responses-v1"
        ? "callback_url"
        : "none");
  return {
    providerLabel: profile.label,
    providerId: accountProviderIdentity(profile),
    inputKind,
    ...(profile.connection?.personalOnly ? { personalOnly: true } : {}),
  };
}
