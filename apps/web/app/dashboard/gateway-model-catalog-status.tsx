"use client";

import { useState } from "react";
import { Button } from "@reviewrouter/ui";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import {
  publicCatalogRefreshFailed,
  type ProviderModelCatalogState,
} from "./provider-model-catalog";

type CatalogStatusProps = {
  account: AccountView | undefined;
  loading: boolean;
  canRefresh: boolean;
  onRefresh: () => Promise<void>;
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

function CatalogStatus({
  account,
  loading,
  canRefresh,
  onRefresh,
  publicCatalog,
}: CatalogStatusProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const catalog = account?.modelCatalog;
  // A configured profile list is not account discovery. In particular, a
  // refreshable client adapter alone does not establish upstream support.
  const refreshSupported =
    canRefresh &&
    account?.binding &&
    catalog &&
    catalog.status !== "unsupported";
  const message =
    loading || refreshing
      ? "Loading model choices…"
      : refreshFailed
        ? "Could not update account models. Your saved selection is unchanged."
        : catalog?.status === "snapshot"
          ? `Account model catalog${catalog.models.length === 0 ? ": no models returned" : ""}.`
          : catalog?.status === "unsupported"
            ? "Account model discovery is not supported for this connection."
            : catalog
              ? `Could not load account models. ${catalog.models.length ? "Showing configured profile choices." : "Try refreshing the model list."} Your saved selection is unchanged.`
              : "Models from the connected profile. Account-specific discovery is not offered.";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span role="status">
          {message}
          {catalog?.status === "snapshot" && catalog.fetchedAt ? (
            <>
              {" "}
              Updated{" "}
              <time dateTime={catalog.fetchedAt}>
                {new Date(catalog.fetchedAt).toLocaleString()}
              </time>
              .
            </>
          ) : null}
        </span>
        {refreshSupported || publicCatalog ? (
          <Button
            type="button"
            variant="ghost"
            disabled={loading || refreshing}
            onClick={async () => {
              setRefreshFailed(false);
              setRefreshing(true);
              // The public refresh reports its own failure through its query.
              const [accountRefresh] = await Promise.allSettled([
                refreshSupported ? onRefresh() : undefined,
                publicCatalog?.refresh(),
              ]);
              if (accountRefresh.status === "rejected") setRefreshFailed(true);
              setRefreshing(false);
            }}
          >
            Refresh models
          </Button>
        ) : null}
      </div>
      {publicCatalog && publicCatalogRefreshFailed(publicCatalog) ? (
        <p role="status" className="text-xs text-slate-400">
          Could not update public model metadata. Showing saved model choices.
        </p>
      ) : null}
    </>
  );
}
