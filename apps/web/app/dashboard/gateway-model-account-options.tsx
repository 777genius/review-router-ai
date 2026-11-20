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
  type QueryKey,
  useInfiniteQuery,
  useQueries,
} from "@tanstack/react-query";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  ACCOUNT_READ_STALE_MS,
  accountReadSchedule,
} from "../../src/features/provider-setup/account-model-catalog-freshness";

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
type AccountDetail = Awaited<ReturnType<GatewayModelAccountsApi["get"]>>;
type DetailQuery = {
  state: { data: AccountDetail | undefined; dataUpdatedAt: number };
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
              const viewer = `${context.scope.split(":workspace:")[0]}:workspace:`;
              const predicate = ({ queryKey: key }: { queryKey: QueryKey }) =>
                (key[0] === "account-options" ||
                  key[0] === "account-option" ||
                  key[0] === "accounts-overview") &&
                typeof key[1] === "string" &&
                key[1].startsWith(viewer);
              await context.client.cancelQueries({ predicate });
              await context.client.invalidateQueries({ predicate });
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

/** What a model list status needs from the accounts read. */
export type GatewayModelAccountsRefresh = Pick<
  ReturnType<typeof useGatewayModelAccounts>,
  "bindingLoading" | "canRefresh" | "refreshModels"
>;

/**
 * A failed read of a binding that was read before keeps its display metadata,
 * so the failure stays visible and retryable, but drops catalog admission,
 * freshness and capabilities. Without an earlier read it is unavailable.
 */
function failedAccountRead(
  current: AccountDetail | undefined,
  bindingId: string,
): AccountDetail {
  if (
    current?.status !== "ok" ||
    current.value.account.binding?.id !== bindingId
  )
    return { status: "unavailable" };
  const { account, profile } = current.value;
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
      staleTime: ACCOUNT_READ_STALE_MS,
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
          // A failed read is a result, not an error, so it is not retried on
          // every mount. Without an earlier read it is unavailable and waits
          // the failure cooldown. After one the account stays visible without
          // its models, on the schedule of `accountReadSchedule`: the cooldown
          // for a required list (NVIDIA), the ordinary staleness otherwise.
          queryFn: async ({ queryKey }): Promise<AccountDetail> => {
            const failed = () =>
              failedAccountRead(client.getQueryData(queryKey), bindingId);
            try {
              const value = await context!.api.get(bindingId);
              return value.status === "unavailable" ? failed() : value;
            } catch {
              return failed();
            }
          },
          enabled: Boolean(context),
          // The model list an open picker shows is read again before it
          // lapses, and an out-of-date or failed one once per open after its
          // cooldown, so the user never has to refresh it by hand.
          staleTime: (query: DetailQuery) =>
            accountReadSchedule(query.state.data, query.state.dataUpdatedAt)
              .staleTime,
          refetchInterval: (query: DetailQuery) => {
            const { refreshAt } = accountReadSchedule(
              query.state.data,
              query.state.dataUpdatedAt,
            );
            return refreshAt === null
              ? false
              : Math.max(1_000, refreshAt - Date.now());
          },
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
      listFailed: initial !== undefined && initial.status !== "ok",
      bindingLoading: (bindingId: string) => {
        void bindingId;
        return false;
      },
      loadMore: () => {},
      refresh: () => {},
      refreshModels: async (bindingId: string) => {
        void bindingId;
      },
      recheck: (bindingId: string) => {
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
        client.setQueryData<AccountDetail>(queryKey, (current) =>
          failedAccountRead(current, bindingId),
        );
      try {
        const value = await context.api.get(bindingId, { forceRefresh: true });
        if (value.status === "unavailable") unavailable();
        else client.setQueryData(queryKey, value);
      } catch {
        unavailable();
      }
    },
    /** Reread one chosen binding only, e.g. while it finishes connecting. */
    recheck(bindingId: string) {
      void client.refetchQueries({
        queryKey: ["account-option", context.scope, bindingId],
        exact: true,
      });
    },
    canLoadMore: Boolean(pages.hasNextPage),
    canRefresh: true,
    loading: pages.isFetching || details.some((detail) => detail.isFetching),
    /** Whether this one binding's own read is in flight. */
    bindingLoading: (bindingId: string) =>
      details[
        [...new Set(selectedBindingIds.filter(Boolean))].indexOf(bindingId)
      ]?.isFetching === true,
    pageError: pages.isError || Boolean(failedPage),
    /** The account list itself could not be read (not just one binding). */
    listFailed:
      !pages.isPending &&
      (pages.isError || Boolean(failedPage) || result.status !== "ok"),
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
