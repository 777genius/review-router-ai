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
        ...fallback.filter((option) => option.provider === "codex-mimo"),
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
        {snapshot
          ? `Catalog: ${snapshot.source} · ${snapshot.state} · ${snapshot.fetchedAt === null ? "no successful fetch" : `fetched ${new Date(snapshot.fetchedAt).toISOString()}`}`
          : "Catalog unavailable"}
        {snapshot?.refresh === "cooldown" ? " · refresh cooldown" : ""}
        {snapshot?.error === "source_unavailable"
          ? " · source unavailable; using displayed catalog"
          : snapshot?.error === "invalid_section"
            ? " · invalid source data; using displayed catalog"
            : ""}
        {status.failed || snapshot?.refresh === "failed"
          ? " · refresh failed"
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
      {publicSelection ? <span>Account access not checked.</span> : null}
    </div>
  );
}
