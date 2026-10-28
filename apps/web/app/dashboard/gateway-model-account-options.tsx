"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  QueryClient,
  useInfiniteQuery,
  useQueries,
} from "@tanstack/react-query";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";

export type GatewayModelAccountsApi = {
  list(request: {
    afterBindingId?: string;
    limit: number;
  }): Promise<AccountsResult<AccountsPage>>;
  get(
    bindingId: string,
    options?: { readonly forceRefresh?: boolean },
  ): Promise<
    AccountsResult<{ account: AccountView; profile: AccountProfileView }>
  >;
};
const OptionsContext = createContext<{
  scope: string;
  api: GatewayModelAccountsApi;
  client: QueryClient;
} | null>(null);

export function useGatewayModelAccountScope() {
  return useContext(OptionsContext)?.scope ?? null;
}

export function useGatewayModelAccountsQueryClient(
  scope: string,
): QueryClient | null {
  const context = useContext(OptionsContext);
  return context?.scope === scope ? context.client : null;
}

// Account management, sharing, recipient rows and Models use the actual same
// scoped client. Cancel older reads before refreshing confirmed availability.
export function useCurrentGatewayModelAccountsCache() {
  const context = useContext(OptionsContext);
  return useMemo(
    () =>
      context
        ? {
            client: context.client,
            async refresh() {
              const queries = context.client
                .getQueryCache()
                .getAll()
                .filter(
                  (query) =>
                    (query.queryKey[0] === "account-options" ||
                      query.queryKey[0] === "account-option" ||
                      query.queryKey[0] === "accounts-overview") &&
                    typeof query.queryKey[1] === "string" &&
                    query.queryKey[1].startsWith(
                      `${context.scope.split(":workspace:")[0]}:workspace:`,
                    ),
                );
              await Promise.all(
                queries.map((query) =>
                  context.client.cancelQueries({
                    queryKey: query.queryKey,
                    exact: true,
                  }),
                ),
              );
              await Promise.all(
                queries.map((query) =>
                  context.client.invalidateQueries({
                    queryKey: query.queryKey,
                    exact: true,
                  }),
                ),
              );
            },
          }
        : null,
    [context],
  );
}

// Optional composition seam. Without a server-authorized adapter the existing
// first-paint behavior is retained, and no additional endpoint is called.
export function GatewayModelAccountsProvider({
  scope,
  api,
  children,
}: {
  scope: string;
  api: GatewayModelAccountsApi;
  children: ReactNode;
}) {
  const [client] = useState(() => new QueryClient());
  const viewerScope = scope.split(":workspace:")[0];
  const previousViewer = useRef(viewerScope);
  useEffect(() => {
    if (previousViewer.current !== viewerScope) {
      client.clear();
      previousViewer.current = viewerScope;
    }
  }, [client, viewerScope]);
  return (
    <OptionsContext.Provider value={{ scope, api, client }}>
      {children}
    </OptionsContext.Provider>
  );
}

export function useGatewayModelAccounts(
  initial: AccountsResult<AccountsPage> | undefined,
  selectedBindingIds: readonly string[],
) {
  const context = useContext(OptionsContext);
  const [fallbackClient] = useState(() => new QueryClient());
  const client = context?.client ?? fallbackClient;
  const pages = useInfiniteQuery(
    {
      queryKey: ["account-options", context?.scope ?? "disabled"] as const,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }) =>
        context!.api.list({
          ...(pageParam ? { afterBindingId: pageParam } : {}),
          limit: 25,
        }),
      ...(initial
        ? { initialData: { pages: [initial], pageParams: [null] } }
        : {}),
      getNextPageParam: (page) =>
        page.status === "ok" ? page.value.nextCursor : null,
      enabled: Boolean(context),
      staleTime: 15000,
      retry: false,
    },
    client,
  );
  const details = useQueries(
    {
      queries: [...new Set(selectedBindingIds.filter(Boolean))].map(
        (bindingId) => ({
          queryKey: [
            "account-option",
            context?.scope ?? "disabled",
            bindingId,
          ] as const,
          queryFn: () => context!.api.get(bindingId),
          enabled: Boolean(context),
          staleTime: 15000,
          retry: false,
        }),
      ),
    },
    client,
  );
  if (!context)
    return {
      accounts: initial,
      canLoadMore: false,
      canRefresh: false,
      loading: false,
      loadMore: () => {},
      refresh: () => {},
      refreshModels: async (bindingId: string) => {
        void bindingId;
      },
      profileFor: (account: AccountView | undefined) =>
        initial?.status === "ok"
          ? initial.value.profiles.find(
              (profile) => profile.id === account?.profileId,
            )
          : undefined,
    };
  const availablePages = pages.data?.pages ?? [];
  const failedPage = availablePages.find((page) => page.status !== "ok");
  const accounts = new Map<string, AccountView>();
  const profiles = new Map<string, AccountProfileView>();
  for (const page of availablePages)
    if (page.status === "ok") {
      for (const account of page.value.accounts)
        if (account.binding) accounts.set(account.binding.id, account);
      for (const profile of page.value.profiles)
        profiles.set(profile.id, profile);
    }
  // Keep an exact known page row during its first detail read. Once settled,
  // that read wins; unavailable IDs never follow a newer binding lifetime.
  [...new Set(selectedBindingIds.filter(Boolean))].forEach(
    (bindingId, index) => {
      const detail = details[index];
      if (detail?.isPending) return;
      accounts.delete(bindingId);
      if (
        !detail?.isError &&
        detail?.data?.status === "ok" &&
        detail.data.value.account.binding?.id === bindingId
      ) {
        accounts.set(bindingId, detail.data.value.account);
        // Account catalogs are scoped by binding, never by a shared profile ID.
        // Global profile seeds remain unchanged.
      }
    },
  );
  const result: AccountsResult<AccountsPage> = availablePages.some(
    (page) => page.status === "ok",
  )
    ? {
        status: "ok",
        value: {
          accounts: [...accounts.values()],
          profiles: [...profiles.values()],
          nextCursor: pages.hasNextPage
            ? availablePages.at(-1)?.status === "ok"
              ? (availablePages.at(-1) as { status: "ok"; value: AccountsPage })
                  .value.nextCursor
              : null
            : null,
        },
      }
    : (failedPage ?? { status: "unavailable" });
  return {
    accounts: result,
    profileFor: (
      account: AccountView | undefined,
    ): AccountProfileView | undefined => {
      if (!account?.binding) return undefined;
      const index = [...new Set(selectedBindingIds.filter(Boolean))].indexOf(
        account.binding.id,
      );
      const detail = index < 0 ? undefined : details[index];
      if (
        detail?.data?.status === "ok" &&
        detail.data.value.account.binding?.id === account.binding.id
      )
        return detail.data.value.profile;
      const seed = profiles.get(account.profileId);
      if (!seed) return undefined;
      if (account.modelCatalog)
        return {
          ...seed,
          models: [...account.modelCatalog.models],
          ...(account.connection ? { connection: account.connection } : {}),
        };
      // A selected Codex account waits for its own catalog. Other accounts
      // retain the established profile catalog for first paint/backcompat.
      return seed.id === "openai-codex-oauth-responses-v1"
        ? {
            ...seed,
            models: [],
            ...(seed.connection
              ? { connection: { ...seed.connection, modelSettings: [] } }
              : {}),
          }
        : seed;
    },
    async refreshModels(bindingId: string) {
      const queryKey = ["account-option", context.scope, bindingId] as const;
      await client.cancelQueries({ queryKey, exact: true });
      const unavailable = () =>
        client.setQueryData<
          Awaited<ReturnType<GatewayModelAccountsApi["get"]>>
        >(queryKey, (current) => {
          if (
            current?.status !== "ok" ||
            current.value.account.binding?.id !== bindingId
          )
            return { status: "unavailable" };
          const { account, profile } = current.value;
          // Retain known display metadata so a transient refresh failure remains
          // retryable, but discard catalog admission and freshness/capabilities.
          return {
            status: "ok",
            value: {
              account: {
                ...account,
                modelCatalog: {
                  status: "unknown",
                  source: "legacy_profile",
                  models: [],
                },
                ...(account.connection
                  ? { connection: { ...account.connection, modelSettings: [] } }
                  : {}),
              },
              profile: {
                ...profile,
                models: [],
                ...(profile.connection
                  ? { connection: { ...profile.connection, modelSettings: [] } }
                  : {}),
              },
            },
          };
        });
      try {
        const value = await context.api.get(bindingId, { forceRefresh: true });
        if (value.status === "unavailable") unavailable();
        else client.setQueryData(queryKey, value);
      } catch {
        unavailable();
      }
    },
    canLoadMore: Boolean(pages.hasNextPage),
    canRefresh: true,
    loading: pages.isFetching || details.some((detail) => detail.isFetching),
    pageError: pages.isError || Boolean(failedPage),
    loadMore: () => {
      void pages.fetchNextPage();
    },
    refresh: () => {
      void Promise.all([
        pages.refetch(),
        ...details.map((detail) => detail.refetch()),
      ]);
    },
  };
}
