import type { WorkspaceProviderProfile } from "@reviewrouter/features-review-config";
import type { ProviderSetupFacts } from "../features/provider-setup/provider-setup-model";
import { savedProviderIdentity } from "./provider-identity";

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
