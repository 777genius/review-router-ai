"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
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
  ): Promise<
    AccountsResult<{ account: AccountView; profile: AccountProfileView }>
  >;
};
const OptionsContext = createContext<{
  scope: string;
  api: GatewayModelAccountsApi;
  client: QueryClient;
} | null>(null);

export function useGatewayModelAccountsQueryClient(
  scope: string,
): QueryClient | null {
  const context = useContext(OptionsContext);
  return context?.scope === scope ? context.client : null;
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
        profiles.set(detail.data.value.profile.id, detail.data.value.profile);
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
