import type {
  AccountsPage,
  AccountsResult,
} from "../../server/account-gateway-accounts";
import type { ApiKeySetupIntent } from "./api-key-storage";
import {
  setupProviderForGatewayProfile,
  type SetupProviderId,
} from "./setup-provider";
import { getReadyGatewayAccounts } from "../../server/dashboard-provider-setup-readiness";

/** Selection readiness uses the selected workspace's trusted provider inventory. */
export function hasReadySetupProvider(
  accounts: AccountsResult<AccountsPage> | undefined,
  provider: SetupProviderId,
): boolean {
  const page = accounts?.status === "ok" ? accounts.value : undefined;
  return getReadyGatewayAccounts(accounts).some(
    (account) =>
      setupProviderForGatewayProfile(
        page?.profiles.find((profile) => profile.id === account.profileId),
      ) === provider,
  );
}

/** Navigation only: enrollment and sharing keep their existing server authority. */
export function connectionSetupContinuation(input: {
  intent: ApiKeySetupIntent | undefined;
  workspace: AccountsResult<AccountsPage> | undefined;
  personal: AccountsResult<AccountsPage> | undefined;
  available?: AccountsResult<AccountsPage> | undefined;
}) {
  const provider =
    input.intent?.storage === "reviewrouter"
      ? input.intent.provider
      : undefined;
  const matchingProfiles = (page: AccountsResult<AccountsPage> | undefined) =>
    page?.status === "ok" && provider
      ? page.value.profiles.filter(
          (profile) =>
            profile.availability !== "deployment_configuration_required" &&
            setupProviderForGatewayProfile(profile) === provider,
        )
      : [];
  const existing = (page: AccountsResult<AccountsPage> | undefined) => {
    const profileIds = new Set(
      matchingProfiles(page).map((profile) => profile.id),
    );
    return page?.status === "ok"
      ? page.value.accounts.some(
          (account) =>
            profileIds.has(account.profileId) &&
            account.state !== "disabled" &&
            account.state !== "tombstoned",
        )
      : false;
  };
  const workspaceExisting = existing(input.available ?? input.workspace);
  const personalExisting = existing(input.personal);
  const workspaceSupported = matchingProfiles(input.workspace).some(
    (profile) => !profile.connection?.personalOnly,
  );
  return {
    autoOpen: Boolean(
      provider &&
      !workspaceExisting &&
      !personalExisting &&
      (workspaceSupported || matchingProfiles(input.personal).length > 0),
    ),
    ownership: workspaceSupported
      ? ("organization" as const)
      : ("personal" as const),
    view:
      !workspaceExisting && personalExisting
        ? ("own" as const)
        : ("available" as const),
  };
}
