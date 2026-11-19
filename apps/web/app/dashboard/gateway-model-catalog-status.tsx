"use client";

import { useState } from "react";
import { Button } from "@reviewrouter/ui";
import type {
  AccountProfileView,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import { accountModelCatalogOutOfDate } from "../../src/features/provider-setup/account-model-catalog-freshness";
import { durationText } from "./account-limits-line";
import type { GatewayModelAccountsRefresh } from "./gateway-model-account-options";
import {
  publicCatalogRefreshFailed,
  type ProviderModelCatalogState,
} from "./provider-model-catalog";

type CatalogStatusProps = {
  account: AccountView | undefined;
  /** The profile whose models the picker offers for this account. */
  profile:
    | (Pick<AccountProfileView, "id" | "protocol"> &
        Partial<Pick<AccountProfileView, "authKind" | "connection">>)
    | undefined;
  /** The accounts read that owns this binding's model list. */
  accounts: GatewayModelAccountsRefresh;
  bindingId: string;
  /**
   * Public metadata for the same provider. It shares this status and button,
   * so a Gateway selection never shows a second, contradicting catalog line.
   * The button stays available for it even when the account cannot list
   * models itself.
   */
  publicCatalog?: ProviderModelCatalogState | null;
};

/** Discovery state belongs to the selected binding, including an empty result. */
export function GatewayModelCatalogStatus(props: CatalogStatusProps) {
  return (
    <CatalogStatus
      key={JSON.stringify([
        props.account?.connectionId,
        props.account?.binding?.id,
      ])}
      {...props}
    />
  );
}

const updatedAgo = (fetchedAt: string) => {
  const minutes = Math.floor((Date.now() - Date.parse(fetchedAt)) / 60_000);
  return minutes < 1 ? "just now" : `${durationText(minutes)} ago`;
};

/**
 * The account's model list keeps itself current (see `accountReadSchedule`),
 * so this line only reports it. "Try again" appears when an update failed;
 * the small refresh next to "Updated ..." stays as a secondary control.
 */
function CatalogStatus({
  account,
  profile,
  accounts: { loading, canRefresh, refreshModels },
  bindingId,
  publicCatalog,
}: CatalogStatusProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const catalog = account?.modelCatalog;
  const busy = loading || refreshing;
  // A configured profile list is not account discovery. In particular, a
  // refreshable client adapter alone does not establish upstream support.
  const refreshSupported =
    canRefresh &&
    account?.binding &&
    catalog &&
    catalog.status !== "unsupported";
  // Without an account or its profile there is no model list to report.
  if (!account && !profile) return null;
  const outOfDate = accountModelCatalogOutOfDate(profile, catalog);
  const [message, action]: [string, "retry" | "refresh" | null] = outOfDate
    ? busy
      ? [
          catalog?.status === "snapshot"
            ? "The model list for this account is out of date. Updating it now…"
            : "Updating the model list for this account…",
          null,
        ]
      : [
          !account
            ? "Could not reach this account to update its model list."
            : catalog?.status === "snapshot"
              ? "The model list for this account is out of date."
              : catalog?.status === "unavailable"
                ? "The provider did not send a model list for this account."
                : "Could not update the model list for this account.",
          canRefresh ? "retry" : null,
        ]
    : busy && catalog?.status !== "snapshot"
      ? ["Loading model choices…", null]
      : refreshFailed
        ? [
            "Could not update account models. Your saved selection is unchanged.",
            "retry",
          ]
        : catalog?.status === "snapshot"
          ? [
              `${catalog.models.length === 0 ? "This account lists no models right now. " : ""}Model list updated ${catalog.fetchedAt ? updatedAgo(catalog.fetchedAt) : "recently"}.`,
              "refresh",
            ]
          : catalog?.status === "unsupported"
            ? [
                "Account model discovery is not supported for this connection.",
                "refresh",
              ]
            : catalog
              ? [
                  `Could not load account models. ${catalog.models.length ? "Showing configured profile choices. " : ""}Your saved selection is unchanged.`,
                  "retry",
                ]
              : [
                  "Models from the connected profile. Account-specific discovery is not offered.",
                  "refresh",
                ];
  const refreshAccount = Boolean(refreshSupported || (outOfDate && canRefresh));
  const showAction =
    action === "retry"
      ? refreshAccount || Boolean(publicCatalog)
      : action === "refresh" && (refreshSupported || Boolean(publicCatalog));
  async function refresh() {
    setRefreshFailed(false);
    setRefreshing(true);
    // The public refresh reports its own failure through its query.
    const [accountRefresh] = await Promise.allSettled([
      refreshAccount ? refreshModels(bindingId) : undefined,
      publicCatalog?.refresh(),
    ]);
    if (accountRefresh.status === "rejected") setRefreshFailed(true);
    setRefreshing(false);
  }
  return (
    <div className="grid gap-1 text-xs text-slate-400">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span role="status">{message}</span>
        {showAction ? (
          action === "retry" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Try again
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Refresh models"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          )
        ) : null}
      </div>
      {publicCatalog && publicCatalogRefreshFailed(publicCatalog) ? (
        <p role="status">
          Could not update public model metadata. Showing saved model choices.
        </p>
      ) : null}
    </div>
  );
}
