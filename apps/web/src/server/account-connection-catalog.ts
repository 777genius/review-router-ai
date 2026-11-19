import { directNativeAPIProfiles } from "../features/account-gateway/native-api-profiles";
import {
  connectionMethodAllowed,
  type AccountConnectionMethod,
  type AccountUpstreamProvider,
} from "../features/account-gateway/connection-capabilities";
import { accountProviderIdentity } from "../features/provider-setup/provider-identity";
import * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
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

/** Exact native profiles qualified for this product; no provider implementation lives here. */
export const nvidiaProfileId = "nvidia-build-chat-apikey-v1";

type Capability = {
  profileId: string;
  provider: { identity: string; label: string };
  planLabel: string;
  region: { identity: string; label: string };
  protocol: c.Profile["protocol"];
  models: c.ProviderConnectionCapability["models"];
  authKind: "api_key" | "oauth";
  methods?: readonly AccountConnectionMethod[];
  oauthMethods: readonly ("browser" | "device_code")[];
  canReconnect: boolean;
  completionInputKind: "none" | "callback_url" | "authorization_code";
  limitsContract: c.ProviderConnectionCapability["limitsContract"];
  availability: "enabled" | "deployment_configuration_required";
};
function legacyCapability(wire: c.ProviderConnectionCapability): Capability {
  return {
    profileId: wire.profileId,
    provider: wire.provider,
    planLabel: wire.plan.label,
    region: wire.region,
    protocol: wire.protocol,
    models: wire.models,
    authKind: wire.authMethods.includes("api_key") ? "api_key" : "oauth",
    oauthMethods: [
      ...(wire.authMethods.includes("oauth_authorization_code")
        ? ["browser" as const]
        : []),
      ...(wire.authMethods.includes("oauth_device_code")
        ? ["device_code" as const]
        : []),
    ],
    canReconnect: wire.reconnect !== "none",
    completionInputKind: wire.completionInputKind,
    limitsContract: wire.limitsContract,
    availability: wire.availability,
  };
}
function nativeCapability(wire: c.ProviderConnectionCapabilityV2): Capability {
  const browser = wire.methods.find((method) => method.kind === "browser");
  return {
    profileId: wire.profileId,
    provider: { identity: wire.provider.id, label: wire.provider.label },
    planLabel: wire.product.label,
    region: { identity: wire.region.id, label: wire.region.label },
    protocol: wire.protocol,
    models: wire.models,
    authKind: wire.methods.some((method) => method.kind === "api_key")
      ? "api_key"
      : "oauth",
    // Explicit allowlist strips native callback configuration from UI projections.
    methods: wire.methods.map((method) =>
      method.kind === "credential_import"
        ? {
            kind: method.kind,
            method: method.method,
            maxBytes: method.maxBytes,
            create: method.create,
            reconnect: method.reconnect,
          }
        : {
            kind: method.kind,
            create: method.create,
            reconnect: method.reconnect,
          },
    ),
    oauthMethods: wire.methods.flatMap((method) =>
      method.kind === "browser" || method.kind === "device_code"
        ? [method.kind]
        : [],
    ),
    canReconnect: wire.methods.some((method) => method.reconnect),
    completionInputKind: browser?.completionInputKind ?? "none",
    limitsContract: wire.limitsContract,
    availability: wire.availability,
  };
}
function absent(error: unknown): boolean {
  return (
    error instanceof GatewayError &&
    (error as GatewayError & { httpStatus?: number }).httpStatus === 404
  );
}
function qualifiedNvidia(wire: Capability): boolean {
  return (
    wire.profileId === nvidiaProfileId &&
    wire.provider.identity === "nvidia" &&
    wire.protocol === "openai-responses" &&
    wire.authKind === "api_key" &&
    wire.completionInputKind === "none" &&
    wire.availability === "enabled"
  );
}
function connectionViewFor(
  wire: Capability,
): NonNullable<AccountProfileView["connection"]> {
  // Every caller has already matched a qualified profile or an approved legacy identity.
  return {
    provider: wire.provider.identity as AccountUpstreamProvider,
    planLabel: qualifiedNvidia(wire) ? "API key" : wire.planLabel,
    regionLabel: wire.region.label,
    completionInputKind: wire.completionInputKind,
    limitsContract: wire.limitsContract,
    modelSettings: wire.models,
    ...(wire.methods ? { methods: wire.methods } : {}),
  };
}

/** Project the selected discovery contract. An attempted v2 read never probes v1. */
export async function connectionProfiles(input: {
  legacy: readonly AccountProfileView[];
  /** Omit when enriching an already authorized review catalog. */
  subscriptionProfileIds?: readonly string[];
  capabilities?: () => Promise<c.ProviderConnectionCapabilities>;
  capabilitiesV2?: () => Promise<c.ProviderConnectionCapabilitiesV2>;
}): Promise<AccountProfileView[]> {
  let capabilities: Capability[];
  if (input.capabilitiesV2) {
    capabilities = c.providerConnectionCapabilitiesV2
      .parse(await input.capabilitiesV2())
      .capabilities.map(nativeCapability);
  } else {
    // Separately composed v1-only consumers retain their existing compatibility contract.
    // New composition always supplies v2; any error remains a discovery failure.
    try {
      capabilities = input.capabilities
        ? c.providerConnectionCapabilities
            .parse(await input.capabilities())
            .capabilities.map(legacyCapability)
        : [];
    } catch (error) {
      if (!absent(error)) throw error;
      capabilities = [];
    }
  }
  const byId = new Map(capabilities.map((row) => [row.profileId, row]));
  if (byId.size !== capabilities.length)
    throw new Error("accounts_unavailable");
  const result: AccountProfileView[] = input.legacy.map((legacy) => {
    const wire = byId.get(legacy.id);
    const provider = accountProviderIdentity(legacy);
    if (
      (legacy.id === nvidiaProfileId || provider === "nvidia") &&
      (!wire || !qualifiedNvidia(wire))
    )
      return { ...legacy, availability: "deployment_configuration_required" };
    if (!wire)
      return input.capabilitiesV2
        ? {
            ...legacy,
            availability: "deployment_configuration_required",
            canReconnect: false,
          }
        : legacy;
    if (
      wire.protocol !== legacy.protocol ||
      (provider !== undefined && wire.provider.identity !== provider) ||
      (legacy.authKind !== undefined && legacy.authKind !== wire.authKind)
    )
      throw new Error("accounts_unavailable");
    const models = legacy.models.filter((model) =>
      wire.models.some((entry) => entry.modelId === model),
    );
    const connection = connectionViewFor(wire);
    const productOAuthMethods = legacy.oauthMethods;
    const projected: AccountProfileView = {
      ...legacy,
      availability:
        legacy.availability === "deployment_configuration_required"
          ? legacy.availability
          : wire.availability,
      models,
      ...(wire.methods
        ? {
            canReconnect: wire.canReconnect,
            oauthMethods: productOAuthMethods
              ? wire.oauthMethods.filter((method) =>
                  productOAuthMethods.includes(method),
                )
              : wire.oauthMethods,
          }
        : {}),
      connection: {
        ...connection,
        modelSettings: connection.modelSettings.filter((model) =>
          models.includes(model.modelId),
        ),
      },
    };
    if (wire.methods)
      projected.canReconnect = wire.methods.some((method) =>
        connectionMethodAllowed(
          projected,
          "reconnect",
          method.kind,
          method.kind === "credential_import" ? method.method : undefined,
        ),
      );
    return projected;
  });
  const nvidia = capabilities.find(qualifiedNvidia);
  if (nvidia && !result.some((profile) => profile.id === nvidia.profileId))
    result.push({
      id: nvidia.profileId,
      label: nvidia.provider.label,
      provider: "nvidia",
      protocol: nvidia.protocol,
      models: nvidia.models.map((model) => model.modelId),
      authKind: "api_key",
      canReconnect: nvidia.canReconnect,
      availability: nvidia.availability,
      connection: connectionViewFor(nvidia),
    });
  for (const [id, provider] of Object.entries(directNativeAPIProfiles)) {
    const wire = byId.get(id);
    // A v1 projection cannot qualify these newly admitted API contracts.
    if (
      !wire?.methods ||
      wire.provider.identity !== provider ||
      wire.protocol !== "openai-responses" ||
      wire.region.identity !== "global" ||
      wire.authKind !== "api_key" ||
      !wire.methods.some((method) => method.kind === "api_key")
    )
      continue;
    if (result.some((profile) => profile.id === id)) continue;
    result.push({
      id,
      label: wire.provider.label,
      provider: "codex",
      protocol: wire.protocol,
      models: wire.models.map((model) => model.modelId),
      authKind: "api_key",
      canReconnect: wire.canReconnect,
      availability: wire.availability,
      connection: connectionViewFor(wire),
    });
  }
  if (input.subscriptionProfileIds === undefined) return result;
  for (const id of Object.keys(subscriptionProfileProviders)) {
    if (result.some((profile) => profile.id === id)) continue;
    const wire = byId.get(id);
    const definition = subscriptionProfileDefinition(id)!;
    if (
      !wire ||
      wire.provider.identity !== definition.provider ||
      wire.region.identity !== "global" ||
      wire.protocol !== "openai-responses" ||
      wire.authKind !== definition.authKind
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
      models: wire.models.map((model) => model.modelId),
      authKind: definition.authKind,
      canReconnect: wire.canReconnect,
      ...(definition.authKind === "oauth"
        ? { oauthMethods: wire.oauthMethods }
        : {}),
      connection: connectionViewFor(wire),
    });
  }
  return result;
}
/** v1 compatibility for existing consumers; all version mapping stays in this adapter. */
export function connectionView(
  wire: c.ProviderConnectionCapability,
): NonNullable<AccountProfileView["connection"]> {
  return connectionViewFor(legacyCapability(wire));
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
  };
}
