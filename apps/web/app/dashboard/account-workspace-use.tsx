import { createContext, useCallback, useSyncExternalStore } from "react";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import { accountsCopy } from "./accounts-copy";

/** Whether a row of the Connections list is used by the current workspace. */
export type WorkspaceUse = "used" | "not_added" | "unknown";

export const accountsOverviewKey = (scope: string) =>
  ["accounts-overview", scope] as const;

/**
 * Reads the workspace overview pages as the list below caches them, without a
 * second query observer or request.
 */
export function useCachedAccountsOverview(
  client: QueryClient,
  scope: string | undefined,
): InfiniteData<AccountsResult<AccountsPage>, string | null> | undefined {
  const subscribe = useCallback(
    (notify: () => void) =>
      scope
        ? client.getQueryCache().subscribe((event) => {
            const [kind, eventScope] = event.query.queryKey;
            if (kind === "accounts-overview" && eventScope === scope) notify();
          })
        : () => undefined,
    [client, scope],
  );
  const read = () =>
    scope
      ? client.getQueryData<
          InfiniteData<AccountsResult<AccountsPage>, string | null>
        >(accountsOverviewKey(scope))
      : undefined;
  return useSyncExternalStore(subscribe, read, read);
}

/** The viewer's own rows of the loaded workspace overview, by connection id. */
export type OverviewOwnRows = {
  readonly bySource: ReadonlyMap<string, AccountView>;
  /** Every page loaded without an error and no further page exists. */
  readonly complete: boolean;
};

export function overviewOwnRows(
  data: InfiniteData<AccountsResult<AccountsPage>, unknown> | undefined,
): OverviewOwnRows | null {
  if (!data?.pages.length) return null;
  const bySource = new Map<string, AccountView>();
  for (const page of data.pages)
    if (page.status === "ok")
      for (const row of page.value.accounts)
        if (row.sourceId) bySource.set(row.sourceId, row);
  const last = data.pages.at(-1);
  return {
    bySource,
    complete:
      data.pages.every((page) => page.status === "ok") &&
      last?.status === "ok" &&
      last.value.nextCursor === null,
  };
}

/**
 * The overview lists every usable binding of the viewer's own connection here,
 * including one that waits for a fence after Update key or Reconnect. A missing
 * row means "not added" only when the whole overview loaded and the owner's
 * access summary does not name this workspace either (a binding the overview
 * cannot use, e.g. for a profile outside its catalog, makes no claim).
 */
export function ownConnectionWorkspaceUse(
  sourceId: string,
  overview: OverviewOwnRows | null,
  namedInAccessSummary: boolean,
): WorkspaceUse {
  if (overview?.bySource.has(sourceId)) return "used";
  return overview?.complete && !namedInAccessSummary ? "not_added" : "unknown";
}

export function bindingWorkspaceUse(
  binding: AccountView["binding"],
): WorkspaceUse {
  return binding?.state === "active" ? "used" : "not_added";
}

/**
 * Ids of the viewer's own connections already listed above the workspace rows.
 * Null outside the combined list: the workspace rows then hide nothing.
 */
export const OwnConnectionIdsContext =
  createContext<ReadonlySet<string> | null>(null);

export function WorkspaceUseLine({
  use,
}: {
  readonly use: WorkspaceUse;
}): React.ReactElement | null {
  if (use === "unknown") return null;
  return (
    <span className="mt-1 block text-xs text-slate-400">
      {use === "used" ? accountsCopy.usedHere : accountsCopy.notAddedHere}
    </span>
  );
}
