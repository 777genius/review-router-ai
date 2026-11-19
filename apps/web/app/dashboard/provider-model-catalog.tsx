"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { QueryClient, useQueries } from "@tanstack/react-query";
import {
  catalogSnapshotOptions,
  type ProviderModelCatalogSnapshot,
  type PublicCatalogProvider,
  type ProviderKind,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import { readProviderModelCatalog } from "./provider-model-catalog-api";
import { StatusLine, updatedAgo } from "./status-line";

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
    optionsFor(
      kind: ProviderKind,
      requiresTools: boolean,
      policy: { readonly allowRoutingModels?: boolean } = {},
    ) {
      const index = providers.findIndex((provider) => provider === kind);
      const snapshot = queries[index]?.data;
      return snapshot
        ? catalogSnapshotOptions(snapshot, { requiresTools, ...policy })
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

export type ProviderModelCatalogState = NonNullable<
  ReturnType<ReturnType<typeof useProviderModelCatalogs>["status"]>
>;

/**
 * A failed fetch, or a retained source error after a later cached or cooldown
 * answer, keeps the last snapshot. Both status components say so the same way.
 */
export const publicCatalogRefreshFailed = (status: ProviderModelCatalogState) =>
  status.failed ||
  status.snapshot?.refresh === "failed" ||
  (status.snapshot?.error ?? null) !== null;

/**
 * Status of a public catalog chosen without an account. The list is read again
 * whenever it is opened and not fresh, so the line only reports it: "Try
 * again" after a failure, a small refresh otherwise. A Gateway account has its
 * own catalog status, which also refreshes this public metadata.
 */
export function ProviderModelCatalogStatus({
  status,
}: {
  status: ProviderModelCatalogState | null;
}) {
  if (!status) return null;
  const snapshot = status.snapshot;
  const failed = publicCatalogRefreshFailed(status);
  const message = status.loading
    ? "Updating the model list…"
    : failed
      ? snapshot?.models.length
        ? "Could not update the model list. Showing the last available one."
        : "Could not load the model list."
      : snapshot?.state === "fresh" || snapshot?.state === "stale"
        ? `Model list updated ${snapshot.fetchedAt === null ? "earlier" : updatedAgo(snapshot.fetchedAt)}.`
        : snapshot?.state === "fallback"
          ? "Showing built-in model choices."
          : "Model list is unavailable.";
  const retry = failed || !snapshot || snapshot.state === "unavailable";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <StatusLine
        message={`${message}${snapshot?.refresh === "cooldown" ? " Please wait before refreshing again." : ""}`}
        action={
          status.loading
            ? undefined
            : {
                kind: retry ? "retry" : "refresh-models",
                busy: status.loading,
                onClick: () => void status.refresh(),
              }
        }
      />
      <span>Access to these models has not been checked.</span>
    </div>
  );
}
