"use client";

import { useState } from "react";
import { Button } from "@reviewrouter/ui";
import type { AccountView } from "../../src/server/account-gateway-accounts";

/** Discovery state belongs to the selected binding, including an empty result. */
export function GatewayModelCatalogStatus({
  account,
  loading,
  canRefresh,
  onRefresh,
}: {
  account: AccountView | undefined;
  loading: boolean;
  canRefresh: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const catalog = account?.modelCatalog;
  const message =
    loading || refreshing
      ? "Loading account models..."
      : catalog?.status === "snapshot"
        ? `Codex account models${catalog.models.length === 0 ? ": no models available" : ""}. Updated ${catalog.fetchedAt ? new Date(catalog.fetchedAt).toLocaleString() : "unknown"}.`
        : catalog
          ? `Account model discovery ${catalog.status}. ${catalog.models.length ? "Showing legacy profile choices." : "No models are currently available."}`
          : "Legacy profile model choices.";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
      <span role="status">{message}</span>
      {canRefresh && account?.binding ? (
        <Button
          type="button"
          variant="ghost"
          disabled={loading || refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
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
