import type { WorkspaceProviderProfile } from "@reviewrouter/features-review-config";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import {
  providerIdentityForAuthMode,
  providerIdentityForKind,
  gatewayAPIKeyProviderKinds,
  type ProviderIdentity,
} from "../features/provider-setup/provider-identity";
import {
  nvidiaProfileId,
  subscriptionProfileProviders,
} from "./account-connection-catalog";
import { accountGatewayProfilesConfiguration } from "./account-gateway-accounts";
import type { ProviderSetupFacts } from "../features/provider-setup/provider-setup-model";

/** Resolve saved display identity from the same trusted deployment catalog.
 * This neither discovers credentials nor authorizes a binding or a model.
 */
export function savedProviderIdentity(input: {
  authMode: ProviderAuthMode;
  gatewayProfileRef?: string | null | undefined;
}): ProviderIdentity | undefined {
  if (input.authMode !== "codex_account_gateway")
    return providerIdentityForAuthMode(input.authMode);
  const ref = input.gatewayProfileRef;
  if (!ref) return undefined;
  if (ref === "openai-codex-oauth-responses-v1") return "openai";
  if (ref === "anthropic-claude-oauth-messages-v1") return "anthropic";
  // Fixed like the profiles above: the Gateway capability catalog serves it
  // even when the deployment does not name it in its API-key profile settings.
  if (ref === nvidiaProfileId) return "nvidia";
  if (Object.hasOwn(subscriptionProfileProviders, ref))
    return subscriptionProfileProviders[
      ref as keyof typeof subscriptionProfileProviders
    ];
  try {
    const provider =
      accountGatewayProfilesConfiguration().apiKeyProfiles.get(ref);
    return provider
      ? providerIdentityForKind(gatewayAPIKeyProviderKinds[provider])
      : undefined;
  } catch {
    // An unavailable/retired catalog cannot justify guessing from a label/model.
    return undefined;
  }
}

/** Gateway bindings behind saved providers, for the provider management facts. */
export function savedProfileBindingIds(
  profiles: readonly WorkspaceProviderProfile[],
): string[] {
  return profiles.flatMap((profile) =>
    profile.credential.kind === "gateway_binding"
      ? [profile.credential.bindingId]
      : [],
  );
}

/** One saved provider as the Providers list and the setup dialog read it. */
export function savedProviderProfileFacts(
  profile: WorkspaceProviderProfile,
  personalBindingIds: ReadonlySet<string>,
): ProviderSetupFacts["profiles"][number] {
  const { credential } = profile;
  const gatewayBinding =
    credential.kind === "gateway_binding" ? credential : null;
  return {
    id: profile.id,
    label: profile.label,
    model: profile.model,
    providerId: savedProviderIdentity({
      authMode: credential.authMode,
      gatewayProfileRef: gatewayBinding?.gatewayProfileRef,
    }),
    authMode: credential.authMode,
    credentialKind: credential.kind,
    createdByUserId: profile.createdByUserId,
    gatewayBindingId: gatewayBinding?.bindingId ?? null,
    gatewayProfileRef: gatewayBinding?.gatewayProfileRef ?? null,
    personalBinding:
      gatewayBinding !== null &&
      personalBindingIds.has(gatewayBinding.bindingId),
    rotatingRepositoryId:
      credential.kind === "repository_rotating"
        ? credential.repositoryId
        : null,
  };
}
