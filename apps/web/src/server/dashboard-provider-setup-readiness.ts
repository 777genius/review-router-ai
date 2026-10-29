import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";

/** Keep active bindings available for setup and catalog recovery, even without models. */
export function getGatewaySetupAccounts(
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
          profile.protocol === "openai-responses" &&
          profile.availability !== "deployment_configuration_required",
      ),
  );
}

/** Display readiness only; server mutations recheck binding and model authority. */
export function getReadyGatewayAccounts(
  accounts: AccountsResult<AccountsPage> | undefined,
): AccountView[] {
  if (accounts?.status !== "ok") return [];
  return getGatewaySetupAccounts(accounts).filter((account) => {
    const profile = accounts.value.profiles.find(
      (candidate) => candidate.id === account.profileId,
    );
    return (account.modelCatalog?.models ?? profile?.models ?? []).length > 0;
  });
}

export function isGatewayProviderSetupReady(
  config: ReviewConfiguration,
  accounts: AccountsResult<AccountsPage> | undefined,
): boolean {
  if (config.providers.length === 0 || accounts?.status !== "ok") return false;
  return config.providers.every(
    (provider) =>
      provider.authMode === "codex_account_gateway" &&
      accounts.value.accounts.some((account) => {
        const profile = accounts.value.profiles.find(
          (row) => row.id === account.profileId,
        );
        const models = account.modelCatalog?.models ?? profile?.models ?? [];
        return (
          account.state === "active" &&
          account.binding?.state === "active" &&
          !account.binding.fencePending &&
          account.binding.id === provider.gatewayBindingId &&
          account.profileId === provider.gatewayProfileRef &&
          profile?.protocol === "openai-responses" &&
          profile.availability !== "deployment_configuration_required" &&
          models.includes(provider.model.trim())
        );
      }),
  );
}

export type DashboardProviderSetupReadinessRecord = {
  readonly repositoryId: string | null;
  readonly providerKind: string;
  readonly authMode: string;
  readonly state: string;
  readonly updatedAt: Date;
};
