import { accountModelDiscoverySource } from "@agent-teams/account-gateway/contracts";
import type { ReviewRunNativeProviderContext } from "@reviewrouter/features-review-run-control";

export type GatewayModelQualificationProfile = {
  readonly profileId: string;
  readonly protocol: string;
  readonly authKinds?: readonly string[];
  readonly modelIds: readonly string[];
  readonly nativeContext?: ReviewRunNativeProviderContext;
  readonly modelPolicy?: Readonly<{
    contract: "native-account-models/v2";
    sourceId: string;
    unavailableFallback: "deny" | "qualified_anchor";
  }>;
};

/** Server-qualified dynamic profiles defer exact model membership and capability
 * checks to the authorized Gateway/native catalogue at dispatch. Other profiles
 * retain their configured model allowlist. This does not authorize an account.
 */
export function gatewayProfileAcceptsRequestedModel(
  profile: GatewayModelQualificationProfile,
  model: string,
): boolean {
  return (
    (profile.modelPolicy?.contract === "native-account-models/v2" &&
      profile.nativeContext?.profileId === profile.profileId) ||
    (profile.authKinds ?? []).some(
      (authKind) =>
        accountModelDiscoverySource({
          profileId: profile.profileId,
          protocol: profile.protocol,
          authKind,
        }) !== undefined,
    ) ||
    profile.modelIds.includes(model)
  );
}
