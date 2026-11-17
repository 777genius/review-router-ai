import {
  providerConnectionIdentities,
  providerConnectionIdentity,
  type ProviderIdentity,
} from "@agent-teams/account-gateway/contracts";

// Usage names a provider by its runtime kind, as direct-route rows always did;
// the Gateway SDK names the same vendors openai and anthropic.
const usageNames: Partial<Record<ProviderIdentity, string>> = {
  openai: "codex",
  anthropic: "claude",
};
const usageName = (vendor: ProviderIdentity) => usageNames[vendor] ?? vendor;

/** Usage provider of a qualified Gateway profile; the SDK owns its vendor. */
export function gatewayProfileUsageProvider(
  profileRef: string,
): string | undefined {
  const vendor = providerConnectionIdentity(profileRef)?.provider.identity;
  return vendor && usageName(vendor);
}

/** Every qualified profile with its usage provider, for read-time attribution. */
export const gatewayProfileUsageProviders = providerConnectionIdentities.map(
  (identity) => ({
    profileRef: identity.profileId,
    provider: usageName(identity.provider.identity),
  }),
);

const flatPlans: readonly string[] = ["subscription", "coding_plan", "m_plan"];
/**
 * Gateway usage providers whose every qualified profile is a flat subscription
 * or coding plan; one pay-as-you-go profile of a vendor removes it.
 */
export const gatewaySubscriptionUsageProviders = [
  ...new Set(
    providerConnectionIdentities.map(({ provider }) =>
      usageName(provider.identity),
    ),
  ),
]
  .filter((name) =>
    providerConnectionIdentities
      .filter(({ provider }) => usageName(provider.identity) === name)
      .every(({ plan }) => flatPlans.includes(plan.identity)),
  )
  .sort();
