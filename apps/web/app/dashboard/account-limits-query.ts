import { AccountDiagnosisError } from "../../src/features/account-gateway/account-diagnosis";
import {
  type QueryClient,
  queryOptions,
  mutationOptions,
} from "@tanstack/react-query";
import type {
  AccountLimitsView,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  readAccountLimits,
  refreshAccountLimits,
  type AccountLimitsRequest,
} from "./account-limits-api";

export const accountLimitsKey = (scope: string, connectionId: string) =>
  ["account-limits", scope, connectionId] as const;
export const accountLimitsScope = (context: string, workspaceId?: string) =>
  `${workspaceId ? `workspace:${workspaceId}` : "personal"}:${context.split(".")[0] ?? ""}`;

export function accountLimitsRefreshOptions(
  scope: string,
  request: AccountLimitsRequest,
  client: QueryClient,
) {
  return mutationOptions({
    mutationKey: [
      "account-limits-refresh",
      scope,
      request.connectionId,
    ] as const,
    retry: false,
    gcTime: 0,
    mutationFn: async () => {
      const key = accountLimitsKey(scope, request.connectionId);
      const before =
        client.getQueryData<AccountsResult<AccountLimitsView>>(key);
      if (before?.status !== "ok" || !before.value.refreshAvailable)
        throw new AccountDiagnosisError({
          code: "unsupported",
          source: "application",
        });
      await client.cancelQueries({ queryKey: key, exact: true });
      const result = await refreshAccountLimits(request);
      const current =
        client.getQueryData<AccountsResult<AccountLimitsView>>(key);
      // A detached/reconnected account or a discarded view cannot be resurrected
      // by a late result from the previous lifetime.
      if (
        current?.status !== "ok" ||
        current.value.displayToken !== before.value.displayToken
      )
        return;
      // A real authorization loss must erase the prior numeric observation.
      if (result.status === "denied") {
        client.setQueryData(key, result);
        return;
      }
      if (result.status !== "ok")
        throw new AccountDiagnosisError(
          result.diagnosis ?? {
            code:
              result.status === "invalid" ? "invalid_request" : result.status,
            source: "application",
          },
        );
      if (result.value.status === "unavailable")
        throw new AccountDiagnosisError({
          code: "unavailable",
          source: "gateway",
        });
      if (result.value.status === "unsupported")
        throw new AccountDiagnosisError({
          code: "unsupported",
          source: "gateway",
        });
      if (result.value.fetchedAt < current.value.fetchedAt) return;
      client.setQueryData(key, result);
    },
  });
}

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
