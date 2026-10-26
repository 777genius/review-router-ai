"use client";

import { useState } from "react";
import { Button } from "@reviewrouter/ui";
import type { AccountView } from "../../src/server/account-gateway-accounts";

type CatalogStatusProps = {
  account: AccountView | undefined;
  loading: boolean;
  canRefresh: boolean;
  onRefresh: () => Promise<void>;
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
      {refreshSupported ? (
        <Button
          type="button"
          variant="ghost"
          disabled={loading || refreshing}
          onClick={async () => {
            setRefreshFailed(false);
            setRefreshing(true);
            try {
              await onRefresh();
            } catch {
              setRefreshFailed(true);
            } finally {
              setRefreshing(false);
            }
          }}
        >
          Refresh models
        </Button>
      ) : null}
    </div>
  );
}
