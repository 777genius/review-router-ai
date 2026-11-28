"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { AccountLifecycleRequest } from "../../../../server/account-lifecycle";

type Action = AccountLifecycleRequest["action"];

export function useAccountLifecycleActivities(
  client: QueryClient,
): ReadonlyMap<string, Action | "unknown"> {
  const subscribe = useCallback(
    (listener: () => void) => client.getQueryCache().subscribe(listener),
    [client],
  );
  const snapshot = useCallback(
    () =>
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .flatMap((query) => {
            if (query.queryKey[0] !== "account-lifecycle-activity") return [];
            const data = query.state.data as
              | { pending?: boolean; action?: Action }
              | undefined;
            return data?.pending
              ? [[String(query.queryKey[2]), data.action ?? "unknown"]]
              : [];
          })
          .sort(),
      ),
    [client],
  );
  const value = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return new Map(JSON.parse(value) as Array<[string, Action | "unknown"]>);
}
