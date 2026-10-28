import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type {
  AccountLimitsView,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  readAccountLimits,
  type AccountLimitsRequest,
} from "./account-limits-api";

export const accountLimitsKey = (scope: string, connectionId: string) =>
  ["account-limits", scope, connectionId] as const;
export const accountLimitsScope = (context: string, workspaceId?: string) =>
  `${workspaceId ? `workspace:${workspaceId}` : "personal"}:${context.split(".")[0] ?? ""}`;

export function accountLimitsOptions(
  scope: string,
  request: AccountLimitsRequest,
  client: QueryClient,
) {
  return queryOptions({
    queryKey: accountLimitsKey(scope, request.connectionId),
    queryFn: async ({ signal }) => {
      const key = accountLimitsKey(scope, request.connectionId);
      const before =
        client.getQueryData<AccountsResult<AccountLimitsView>>(key);
      const result = await readAccountLimits(request, signal);
      const current =
        client.getQueryData<AccountsResult<AccountLimitsView>>(key);
      if (
        signal.aborted ||
        (before?.status === "ok" &&
          current?.status === "ok" &&
          before.value.displayToken !== current.value.displayToken)
      )
        throw new Error("Connection changed");
      if (
        result.status === "unavailable" ||
        (result.status === "ok" &&
          result.value.status === "unavailable" &&
          before?.status === "ok" &&
          before.value.status === "snapshot" &&
          before.value.displayToken === result.value.displayToken)
      )
        throw new Error("Saved account limits unavailable");
      return result;
    },
    staleTime: 30_000,
    retry: false,
    enabled: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Move the server projection into its sole interactive cache before storing inventory. */
export function extractAccountLimits<
  T extends { accounts: readonly AccountView[] },
>(
  client: QueryClient,
  scope: string,
  result: AccountsResult<T>,
): AccountsResult<T> {
  if (result.status !== "ok") return result;
  return {
    ...result,
    value: {
      ...result.value,
      accounts: result.value.accounts.map((account) => {
        const { limits, ...inventory } = account;
        if (limits) {
          const key = accountLimitsKey(scope, account.connectionId);
          const prior =
            client.getQueryData<AccountsResult<AccountLimitsView>>(key);
          if (
            prior?.status !== "ok" ||
            prior.value.displayToken !== limits.displayToken ||
            prior.value.fetchedAt < limits.fetchedAt
          ) {
            void client.cancelQueries({ queryKey: key, exact: true });
            client.setQueryData(key, { status: "ok", value: limits });
          }
        }
        return inventory;
      }),
    },
  };
}

export async function removeAccountLimits(
  client: QueryClient,
  scope: string,
  connectionId?: string,
) {
  const queryKey = connectionId
    ? accountLimitsKey(scope, connectionId)
    : (["account-limits", scope] as const);
  await client.cancelQueries({
    queryKey,
    ...(connectionId ? { exact: true } : {}),
  });
  client.removeQueries({ queryKey, ...(connectionId ? { exact: true } : {}) });
}

/** Release an old view without evicting another mounted view of the same account. */
export function releaseAccountLimits(
  client: QueryClient,
  scope: string,
  connectionId?: string,
) {
  queueMicrotask(() => {
    const queryKey = connectionId
      ? accountLimitsKey(scope, connectionId)
      : (["account-limits", scope] as const);
    for (const query of client.getQueryCache().findAll({ queryKey })) {
      if (query.getObserversCount() === 0) {
        void client.cancelQueries({ queryKey: query.queryKey, exact: true });
        client.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  });
}

export async function removeAccountLimitsForConnection(
  client: QueryClient,
  connectionId: string,
) {
  const queries = client.getQueryCache().findAll({
    predicate: (query) =>
      query.queryKey[0] === "account-limits" &&
      query.queryKey[2] === connectionId,
  });
  await Promise.all(
    queries.map((query) =>
      client.cancelQueries({ queryKey: query.queryKey, exact: true }),
    ),
  );
  for (const query of queries)
    client.removeQueries({ queryKey: query.queryKey, exact: true });
}
