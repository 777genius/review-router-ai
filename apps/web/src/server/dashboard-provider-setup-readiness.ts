import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";

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
  return getReadyGatewayAccounts(accounts).some(
    (account) =>
      account.binding?.id === provider.gatewayBindingId &&
      account.profileId === provider.gatewayProfileRef &&
      accounts.value.profiles.some(
        (profile) =>
          profile.id === account.profileId &&
          profile.models.includes(provider.model.trim()),
      ),
  );
}

export type DashboardProviderSetupReadinessRecord = {
  readonly repositoryId: string | null;
  readonly providerKind: string;
  readonly authMode: string;
  readonly state: string;
  readonly updatedAt: Date;
};
