import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import { accountModelDiscoverySource } from "@agent-teams/account-gateway/contracts";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";

export function gatewayReadinessDiscoverySource(profile: AccountProfileView) {
  return profile.authKind
    ? accountModelDiscoverySource({
        profileId: profile.id,
        protocol: profile.protocol,
        authKind: profile.authKind,
      })
    : undefined;
}

/** Display readiness only; server mutations recheck binding authority. */
export function getReadyGatewayAccounts(
  accounts: AccountsResult<AccountsPage> | undefined,
): AccountView[] {
  if (accounts?.status !== "ok") return [];
  const page = accounts.value;
  return page.accounts.filter(
    (account) =>
      account.state === "active" &&
      account.binding?.state === "active" &&
      !account.binding.fencePending &&
      page.profiles.some(
        (profile) =>
          profile.id === account.profileId &&
          profile.availability !== "deployment_configuration_required" &&
          profile.models.length > 0,
      ),
  );
}

export function isGatewayProviderSetupReady(
  config: ReviewConfiguration,
  accounts: AccountsResult<AccountsPage> | undefined,
): boolean {
  const provider = config.providers[0];
  if (
    config.providers.length !== 1 ||
    provider?.authMode !== "codex_account_gateway" ||
    accounts?.status !== "ok"
  ) {
    return false;
  }
  return getReadyGatewayAccounts(accounts).some((account) => {
    if (
      account.binding?.id !== provider.gatewayBindingId ||
      account.profileId !== provider.gatewayProfileRef
    )
      return false;
    const profile = accounts.value.profiles.find(
      (candidate) => candidate.id === account.profileId,
    );
    if (!profile) return false;
    const model = provider.model.trim();
    const source = gatewayReadinessDiscoverySource(profile);
    if (!source) return profile.models.includes(model);
    const catalog = account.modelCatalog;
    if (!catalog) return false;
    // Only the Gateway's explicit unavailable result permits a configured anchor.
    if (catalog.status === "unavailable")
      return (
        catalog.source === "legacy_profile" &&
        catalog.models.includes(model) &&
        profile.models.includes(model)
      );
    const now = Date.now();
    const fetchedAt = Date.parse(catalog.fetchedAt ?? "");
    return (
      catalog.status === "snapshot" &&
      catalog.source === source &&
      Number.isFinite(fetchedAt) &&
      fetchedAt <= now &&
      Date.parse(catalog.expiresAt ?? "") > now &&
      catalog.models.includes(model)
    );
  });
}

export type DashboardProviderSetupReadinessRecord = {
  readonly repositoryId: string | null;
  readonly providerKind: string;
  readonly authMode: string;
  readonly state: string;
  readonly updatedAt: Date;
};
