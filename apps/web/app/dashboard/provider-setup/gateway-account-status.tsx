"use client";

import type {
  AccountProfileView,
  AccountView,
} from "../../../src/server/account-gateway-accounts";
import { accountModelCatalogOutOfDate } from "../../../src/features/provider-setup/account-model-catalog-freshness";
import type { useGatewayModelAccounts } from "../gateway-model-account-options";
import { StatusLine } from "../status-line";

type Accounts = Pick<
  ReturnType<typeof useGatewayModelAccounts>,
  | "accounts"
  | "loading"
  | "listFailed"
  | "canRefresh"
  | "refresh"
  | "recheck"
  | "bindingLoading"
>;

/** The account list itself could not be read: said once, with Try again. */
export function GatewayAccountListStatus({
  accounts,
  busy,
}: {
  accounts: Accounts;
  busy: boolean;
}) {
  if (!accounts.listFailed) return null;
  return (
    <StatusLine
      message={
        accounts.accounts?.status === "denied"
          ? "Account access is unavailable. Check this workspace's access before continuing."
          : "Could not load the account list."
      }
      busy={busy || accounts.loading}
      onRetry={accounts.canRefresh ? accounts.refresh : undefined}
    />
  );
}

/** A chosen binding the account list does not offer. */
export function GatewayBindingStatus({
  accounts,
  bindingId,
  busy,
}: {
  accounts: Accounts;
  bindingId: string;
  busy: boolean;
}) {
  // A failed list is reported once by GatewayAccountListStatus.
  if (accounts.listFailed) return null;
  return (
    <StatusLine
      message="This account is unavailable. Choose another account."
      busy={busy || accounts.bindingLoading(bindingId)}
      onRetry={
        accounts.canRefresh ? () => accounts.recheck(bindingId) : undefined
      }
    />
  );
}

/**
 * Review settings are missing for the chosen Gateway model. The account and
 * its model list update themselves; the model list status offers Try again
 * once the account is read, so this line does only while it is not.
 */
export function GatewayReviewSettingsStatus({
  accounts,
  account,
  profile,
  bindingId,
}: {
  accounts: Accounts;
  account: AccountView | undefined;
  profile: AccountProfileView | undefined;
  bindingId: string | null;
}) {
  // Another model helps only when this account's current list was read.
  const listCurrent =
    account !== undefined &&
    !accounts.listFailed &&
    !accountModelCatalogOutOfDate(profile, account.modelCatalog);
  return (
    <StatusLine
      message={
        accounts.loading
          ? "Loading review settings for this model…"
          : `Review settings are unavailable for this model.${listCurrent ? " Choose another model or provider." : ""}`
      }
      busy={accounts.loading}
      onRetry={
        account || !bindingId || !accounts.canRefresh
          ? undefined
          : accounts.listFailed
            ? accounts.refresh
            : () => accounts.recheck(bindingId)
      }
    />
  );
}
