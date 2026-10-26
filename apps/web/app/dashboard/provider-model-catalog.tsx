"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, useQueries } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import {
  catalogSnapshotOptions,
  type ProviderModelCatalogSnapshot,
  type PublicCatalogProvider,
  type ProviderKind,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import { readProviderModelCatalog } from "./provider-model-catalog-api";

const providers = ["codex", "claude", "openrouter"] as const;
export const providerModelCatalogKey = (kind: PublicCatalogProvider) =>
  ["provider-model-catalog", kind] as const;
export const catalogStaleTime = (
  snapshot: ProviderModelCatalogSnapshot | undefined,
  dataUpdatedAt: number = snapshot?.fetchedAt ?? 0,
) =>
  snapshot?.state === "fresh" && snapshot.fetchedAt !== null
    ? Math.max(0, 30 * 60_000 + snapshot.fetchedAt - dataUpdatedAt)
    : 0;
type CatalogApi = typeof readProviderModelCatalog;
const Context = createContext<{
  snapshots: readonly ProviderModelCatalogSnapshot[];
  client: QueryClient;
  api: CatalogApi;
} | null>(null);

export function ProviderModelCatalogProvider({
  snapshots,
  children,
  api = readProviderModelCatalog,
}: {
  snapshots: readonly ProviderModelCatalogSnapshot[];
  children: ReactNode;
  api?: CatalogApi;
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <Context.Provider value={{ snapshots, client, api }}>
      {children}
    </Context.Provider>
  );
}

export function useProviderModelCatalogs(
  fallback: readonly ReviewModelOption[],
) {
  const context = useContext(Context);
  const [disabledClient] = useState(() => new QueryClient());
  const client = context?.client ?? disabledClient;
  const queries = useQueries(
    {
      queries: providers.map((providerKind) => {
        const initialData = context?.snapshots.find(
          (snapshot) => snapshot.providerKind === providerKind,
        );
        return {
          queryKey: providerModelCatalogKey(providerKind),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            context!.api({ providerKind, signal }),
          ...(initialData
            ? { initialData, initialDataUpdatedAt: initialData.fetchedAt ?? 0 }
            : {}),
          staleTime: (query: {
            state: {
              data: ProviderModelCatalogSnapshot | undefined;
              dataUpdatedAt: number;
            };
          }) => catalogStaleTime(query.state.data, query.state.dataUpdatedAt),
          enabled: Boolean(context),
          retry: false,
          refetchOnWindowFocus: false,
        };
      }),
    },
    client,
  );
  const options = context
    ? [
        ...fallback.filter(
          (option) =>
            !providers.some((provider) => provider === option.provider),
        ),
        ...queries.flatMap((query, index) =>
          query.data
            ? catalogSnapshotOptions(query.data)
            : fallback.filter((option) => option.provider === providers[index]),
        ),
      ]
    : fallback;
  return {
    options,
    optionsFor(kind: ProviderKind, requiresTools: boolean) {
      const index = providers.findIndex((provider) => provider === kind);
      const snapshot = queries[index]?.data;
      return snapshot
        ? catalogSnapshotOptions(snapshot, { requiresTools })
        : options.filter((option) => option.provider === kind);
    },
    status(kind: ProviderKind) {
      const index = providers.findIndex((provider) => provider === kind);
      const query = queries[index];
      if (!context || !query || index < 0) return null;
      return {
        snapshot: query.data,
        loading: query.isFetching,
        failed: query.isError,
        refresh: async () => {
          await client.cancelQueries({
            queryKey: providerModelCatalogKey(providers[index]!),
            exact: true,
          });
          await client
            .fetchQuery({
              queryKey: providerModelCatalogKey(providers[index]!),
              queryFn: ({ signal }) =>
                context.api({
                  providerKind: providers[index]!,
                  forceRefresh: true,
                  signal,
                }),
              staleTime: 0,
              retry: false,
            })
            .catch(() => {});
        },
      };
    },
  };
}

export function ProviderModelCatalogStatus({
  status,
  publicSelection,
}: {
  status: ReturnType<ReturnType<typeof useProviderModelCatalogs>["status"]>;
  publicSelection: boolean;
}) {
  if (!status) return null;
  const snapshot = status.snapshot;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <span role="status">
        {status.loading
          ? "Updating model list…"
          : status.failed ||
              snapshot?.refresh === "failed" ||
              (snapshot?.error !== null && snapshot?.error !== undefined)
            ? snapshot?.models.length
              ? "Could not update the model list. Showing the last available model list."
              : "Could not load the model list. Try refreshing."
            : snapshot?.state === "fresh"
              ? "Model list is up to date."
              : snapshot?.state === "stale"
                ? "Showing the last model list. Refresh to check for updates."
                : snapshot?.state === "fallback"
                  ? "Showing built-in model choices."
                  : "Model list is unavailable. Try refreshing."}
        {snapshot?.refresh === "cooldown"
          ? " Please wait before refreshing again."
          : ""}
      </span>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={status.loading}
        onClick={() => {
          void status.refresh();
        }}
      >
        {status.loading ? "Refreshing models…" : "Refresh models"}
      </Button>
      {publicSelection ? (
        <span>Access to these models has not been checked.</span>
      ) : null}
    </div>
  );
}
