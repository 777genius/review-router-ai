"use client";

import {
  AccountLimitsLine,
  AccountLimitsReadContext,
} from "./account-limits-line";
import {
  accountLimitsScope,
  extractAccountLimits,
  releaseAccountLimits,
  removeAccountLimits,
} from "./account-limits-query";

import {
  AccountLifecycleControls,
  useAccountLifecycleActivities,
} from "./account-lifecycle-controls";

import { useContext, useEffect, useRef, useState } from "react";
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
} from "@tanstack/react-query";
import { Button, Dialog } from "@reviewrouter/ui";
import {
  AccountActionsMenu,
  AccountMenuItem,
  accountMenuItemClass,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import { AccountIdentity } from "./account-identity";
import { AccountOwner, connectionOwnerKind } from "./account-owner";
import { AccountUsageLine } from "./account-usage-line";
import { readAccountResult } from "./account-read-result";
import { accountsGridColumns } from "./accounts-grid";
import {
  accountsOverviewKey,
  bindingWorkspaceUse,
  OwnConnectionIdsContext,
  WorkspaceUseLine,
} from "./account-workspace-use";
import {
  accountsCopy,
  connectionRowStatus,
  removedFromWorkspaceText,
  removeFromWorkspaceCopy,
  type ConnectionOwnerKind,
} from "./accounts-copy";
import { AccountStatusLine } from "./account-status-icon";

import type {
  AccountView,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import { ChooseForReviewsLink } from "./choose-for-reviews-link";
import { refreshPersonalAccountViews } from "./personal-account-controls";
import {
  useGatewayModelAccountsQueryClient,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";

type DetachRequest = { bindingId: string; expectedBindingRevision: number };
type DetachSelection = {
  label: string;
  ownerKind: ConnectionOwnerKind;
  request: DetachRequest;
  returnFocus: HTMLElement | null;
};
type DetachResult = AccountsResult<{
  bindingId: string;
  workspaceId: string;
  revision: number;
  state: "revoked";
  localAuthorization: "local_denied";
  remoteFenceDelivery: "remote_pending" | "remote_applied";
}>;
type Props = {
  scope: string;
  personalScope?: string;
  workspaceId?: string;
  api?: GatewayModelAccountsApi | undefined;
  canDetach: boolean;
  detach(request: DetachRequest): Promise<DetachResult>;
  readDetach?: (request: DetachRequest) => Promise<DetachResult>;
  initialPage?: AccountsResult<AccountsPage> | undefined;
  managementRows?: readonly AccountView[];
  managementActions?: ((account: AccountView) => React.ReactNode) | undefined;
};

function AccountRowMenu({
  account,
  managementRows,
  managementActions,
  canDetach,
  selectDetach,
  lifecycleContext,
  workspaceId,
  client,
}: {
  lifecycleContext: string;
  workspaceId: string;
  client: QueryClient;
  account: AccountView;
  managementRows: readonly AccountView[];
  managementActions?: ((account: AccountView) => React.ReactNode) | undefined;
  canDetach: boolean;
  selectDetach(request: DetachSelection): void;
}) {
  const managed = managementRows.find(
    (row) => row.connectionId === account.connectionId,
  );
  const binding = account.binding;
  return (
    <AccountActionsMenu label={account.label}>
      {managed && managementActions ? managementActions(managed) : null}
      <AccountLifecycleControls
        account={account}
        context={lifecycleContext}
        workspaceId={workspaceId ?? ""}
        client={client}
        usage={account.usage}
      />
      {canDetach &&
      binding?.state === "active" &&
      account.allowedActions?.includes("detach") ? (
        <DetachMenuItem
          select={(returnFocus) =>
            selectDetach({
              label: account.label,
              ownerKind: connectionOwnerKind(account),
              request: {
                bindingId: binding.id,
                expectedBindingRevision: binding.revision,
              },
              returnFocus,
            })
          }
        />
      ) : null}
    </AccountActionsMenu>
  );
}

// Inside the menu so the confirmation can return focus to its trigger.
function DetachMenuItem({
  select,
}: {
  select(returnFocus: HTMLElement | null): void;
}) {
  const trigger = useAccountMenuReturnFocus();
  return (
    <AccountMenuItem>
      <Button
        variant="ghost"
        size="sm"
        className={accountMenuItemClass}
        onClick={() => select(trigger?.current ?? null)}
      >
        {accountsCopy.detach}
      </Button>
    </AccountMenuItem>
  );
}

// Rendering is opt-in at trusted server composition; no endpoint discovery or gate activation.
export function WorkspacePersonalAccounts(props: Props) {
  const sharedClient = useGatewayModelAccountsQueryClient(props.scope);
  const [fallback] = useState(() => new QueryClient());
  if (!props.api || !props.scope) return null;
  return (
    <WorkspacePersonalRows
      key={props.scope}
      {...props}
      api={props.api}
      client={sharedClient ?? fallback}
    />
  );
}

function WorkspacePersonalRows({
  scope,
  personalScope,
  workspaceId,
  api,
  canDetach,
  detach,
  readDetach,
  managementRows = [],
  initialPage,
  managementActions,
  client,
}: Props & { api: GatewayModelAccountsApi; client: QueryClient }) {
  const lifecycleActivities = useAccountLifecycleActivities(client);
  const inheritedLimits = useContext(AccountLimitsReadContext);
  // Inside the combined Connections list the viewer's own connections are
  // already listed above; only rows not shown there stay here.
  const ownConnectionIds = useContext(OwnConnectionIdsContext);
  const limitsContext = inheritedLimits?.context ?? personalScope ?? "";
  const limitsScope =
    inheritedLimits?.scope ?? accountLimitsScope(limitsContext, workspaceId);
  useEffect(
    () => () => {
      releaseAccountLimits(client, limitsScope);
    },
    [client, limitsScope],
  );
  const hydratedBootstrap = useRef(initialPage);
  const removedByBootstrap = new Set(
    hydratedBootstrap.current?.status === "ok" && initialPage?.status === "ok"
      ? hydratedBootstrap.current.value.accounts
          .filter(
            (old) =>
              !initialPage.value.accounts.some(
                (row) => row.connectionId === old.connectionId,
              ),
          )
          .map((row) => row.connectionId)
      : [],
  );
  useEffect(() => {
    if (!initialPage || hydratedBootstrap.current === initialPage) return;
    let current = true;
    void (async () => {
      await client.cancelQueries({
        queryKey: accountsOverviewKey(scope),
        exact: true,
      });
      await removeAccountLimits(client, limitsScope);
      if (!current) return;
      const first = extractAccountLimits(client, limitsScope, initialPage);
      hydratedBootstrap.current = initialPage;
      client.setQueryData<
        InfiniteData<AccountsResult<AccountsPage>, string | null>
      >(accountsOverviewKey(scope), { pages: [first], pageParams: [null] });
    })();
    return () => {
      current = false;
    };
  }, [client, limitsScope, initialPage, scope]);
  const pageKey = accountsOverviewKey(scope);
  // The last chosen removal keeps its text while the dialog closes and returns
  // focus to its row menu afterwards.
  const [selection, setSelection] = useState<DetachSelection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState<{
    request: DetachRequest;
    result: DetachResult;
  } | null>(null);
  const busy = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const pages = useInfiniteQuery(
    {
      queryKey: pageKey,
      initialPageParam: null as string | null,
      ...(initialPage
        ? {
            initialData: () => ({
              pages: [extractAccountLimits(client, limitsScope, initialPage)],
              pageParams: [null],
            }),
          }
        : {}),
      queryFn: ({ pageParam, signal }) =>
        readAccountResult(
          api.list({
            limit: 25,
            ...(pageParam ? { afterBindingId: pageParam } : {}),
          }),
        ).then((result) => {
          if (signal.aborted)
            throw new Error("Account inventory read canceled");
          return extractAccountLimits(client, limitsScope, result);
        }),
      getNextPageParam: (page) =>
        page.status === "ok" ? page.value.nextCursor : null,
      staleTime: 15000,
      retry: false,
    },
    client,
  );
  const mutation = useMutation(
    {
      mutationKey: ["workspace-personal-accounts", scope, "detach"] as const,
      mutationFn: (request: DetachRequest) => detach(request),
      retry: false,
      gcTime: 0,
    },
    client,
  );
  const fetched =
    initialPage && hydratedBootstrap.current !== initialPage
      ? [initialPage]
      : (pages.data?.pages ?? []);
  const failed = pages.isError || fetched.some((p) => p.status !== "ok");
  const denied = fetched.some(
    (page) => page.status !== "ok" && page.status !== "unavailable",
  );
  const rows = fetched.flatMap((page) =>
    page.status === "ok" ? page.value.accounts : [],
  );
  const accounts = [
    ...new Map(rows.map((row) => [row.connectionId, row])).values(),
  ];
  const listed = accounts.filter(
    (row) => !(row.sourceId && ownConnectionIds?.has(row.sourceId)),
  );

  async function submit(request: DetachRequest, readOnly = false) {
    if (!canDetach || busy.current) return;
    busy.current = true;
    setSubmitting(true);
    // Snapshot the exact old binding lifetime; later pages never replace this request.
    const original = {
      bindingId: request.bindingId,
      expectedBindingRevision: request.expectedBindingRevision,
    };
    try {
      let result: DetachResult;
      try {
        result = readOnly
          ? await readDetach!(original)
          : await mutation.mutateAsync(original);
      } catch {
        result = { status: "unavailable" };
      }
      if (
        result.status === "ok" &&
        (result.value.bindingId !== original.bindingId ||
          result.value.state !== "revoked" ||
          result.value.localAuthorization !== "local_denied" ||
          !["remote_pending", "remote_applied"].includes(
            result.value.remoteFenceDelivery,
          ))
      )
        result = { status: "unavailable" };
      const next = result;
      setLast((prior) =>
        next.status === "unavailable" &&
        prior?.result.status === "ok" &&
        prior.request.bindingId === original.bindingId &&
        prior.request.expectedBindingRevision ===
          original.expectedBindingRevision
          ? prior
          : { request: original, result: next },
      );
      setConfirming(false);
      const detailKey = ["account-option", scope, original.bindingId] as const;
      const modelPageKey = ["account-options", scope] as const;
      // A delayed pre-detach fetch must not restore the retired binding to Models.
      await Promise.all([
        client.cancelQueries({ queryKey: pageKey, exact: true }),
        client.cancelQueries({ queryKey: modelPageKey, exact: true }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      if (result.status === "ok") {
        for (const row of accounts.filter(
          (account) => account.binding?.id === original.bindingId,
        ))
          await removeAccountLimits(client, limitsScope, row.connectionId);
        for (const listKey of [pageKey, modelPageKey])
          client.setQueryData<
            InfiniteData<AccountsResult<AccountsPage>, string | null>
          >(listKey, (prior) =>
            prior
              ? {
                  ...prior,
                  pages: prior.pages.map((page) =>
                    page.status === "ok"
                      ? {
                          ...page,
                          value: {
                            ...page.value,
                            accounts: page.value.accounts.flatMap((row) =>
                              row.binding?.id !== original.bindingId
                                ? [row]
                                : // Like the server list: the workspace's own
                                  // connection stays for its admins, now not
                                  // added; other rows leave the list. Models
                                  // never keeps the retired binding.
                                  listKey === pageKey &&
                                    row.origin === "organization"
                                  ? [{ ...row, binding: null }]
                                  : [],
                            ),
                          },
                        }
                      : page,
                  ),
                }
              : prior,
          );
        client.setQueryData(detailKey, { status: "denied" });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: pageKey, exact: true }),
        client.invalidateQueries({ queryKey: modelPageKey, exact: true }),
        client.invalidateQueries({ queryKey: detailKey, exact: true }),
      ]);
      if (personalScope)
        await refreshPersonalAccountViews(client, personalScope);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  const result = last?.result;
  const message =
    result?.status === "ok"
      ? removedFromWorkspaceText(result.value.remoteFenceDelivery)
      : result?.status === "conflict"
        ? "This connection changed. Refresh connections and try again."
        : result?.status === "denied"
          ? "Your access changed. Refresh connections to see the available actions."
          : result
            ? removeFromWorkspaceCopy.unconfirmed
            : null;
  return (
    <section aria-label="Workspace connections">
      {pages.isPending ? <p role="status">Loading connections...</p> : null}
      {failed ? (
        <p role="status">Connections could not be refreshed. Try again.</p>
      ) : null}
      {!pages.isPending &&
      !failed &&
      !listed.length &&
      !ownConnectionIds?.size ? (
        <p className="py-4 text-sm text-slate-400">
          {pages.hasNextPage
            ? "No connections on the loaded pages."
            : accountsCopy.noConnections}
        </p>
      ) : null}
      {ownConnectionIds ? null : (
        <div
          className={`hidden gap-3 border-b border-cyan-200/15 py-2 text-xs uppercase tracking-wider text-slate-400 lg:grid ${accountsGridColumns}`}
          aria-hidden="true"
        >
          <span>Account</span>
          <span>Owner</span>
          <span>Status</span>
          <span />
        </div>
      )}
      {(denied ? [] : listed).map((row) => (
        <article
          key={row.connectionId}
          aria-label={row.label}
          className={`grid min-w-0 items-center gap-3 border-b border-cyan-200/10 py-4 ${accountsGridColumns}`}
        >
          <div className="min-w-0">
            <AccountIdentity
              label={row.label}
              profileLabel={row.profileLabel}
              provider={row.provider}
              authKind={row.authKind}
              nativeCredential={row.nativeCredential}
              connection={row.connection}
              metadata={
                lifecycleActivities.has(row.connectionId)
                  ? { status: "unknown", displayToken: "restricted" }
                  : row.metadata
              }
            />
            <AccountUsageLine usage={row.usage} />
            <AccountLimitsLine
              scope={limitsScope}
              context={limitsContext}
              connectionId={row.connectionId}
              workspaceId={workspaceId}
              client={client}
              expectedDisplayToken={
                initialPage?.status === "ok"
                  ? initialPage.value.accounts.find(
                      (account) => account.connectionId === row.connectionId,
                    )?.limits?.displayToken
                  : inheritedLimits?.projections?.get(row.connectionId)
                      ?.displayToken
              }
              expectedFetchedAt={
                initialPage?.status === "ok"
                  ? initialPage.value.accounts.find(
                      (account) => account.connectionId === row.connectionId,
                    )?.limits?.fetchedAt
                  : inheritedLimits?.projections?.get(row.connectionId)
                      ?.fetchedAt
              }
              expectedStatus={
                initialPage?.status === "ok"
                  ? initialPage.value.accounts.find(
                      (account) => account.connectionId === row.connectionId,
                    )?.limits?.status
                  : inheritedLimits?.projections?.get(row.connectionId)?.status
              }
              blocked={
                removedByBootstrap.has(row.connectionId) ||
                inheritedLimits?.removed?.has(row.connectionId) ||
                inheritedLimits?.denied ||
                (initialPage !== undefined &&
                  initialPage.status !== "ok" &&
                  initialPage.status !== "unavailable") ||
                denied ||
                lifecycleActivities.has(row.connectionId) ||
                row.state === "tombstoned"
              }
            />
          </div>
          <AccountOwner account={row} />
          <div className="text-sm text-slate-300">
            <AccountStatusLine
              {...connectionRowStatus({
                account: row,
                refreshFailed: failed,
                localAction: lifecycleActivities.get(row.connectionId),
              })}
            />
            {failed ? null : (
              <WorkspaceUseLine use={bindingWorkspaceUse(row.binding)} />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!failed &&
            !lifecycleActivities.has(row.connectionId) &&
            row.readiness === "ready" &&
            row.binding?.state === "active" &&
            !row.binding.fencePending ? (
              <ChooseForReviewsLink workspaceId={workspaceId} />
            ) : null}
            {!failed &&
            (managementActions ||
              canDetach ||
              row.canManage ||
              row.isOwnedByViewer) ? (
              <AccountRowMenu
                account={row}
                lifecycleContext={personalScope ?? ""}
                workspaceId={workspaceId ?? ""}
                client={client}
                managementRows={managementRows}
                managementActions={managementActions}
                canDetach={canDetach}
                selectDetach={(next) => {
                  setSelection(next);
                  setConfirming(true);
                }}
              />
            ) : null}
          </div>
        </article>
      ))}
      {/* In the combined list its toolbar refresh already rereads these rows;
          a separate button stays only to recover from a failed read. */}
      {!ownConnectionIds || failed || pages.hasNextPage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!ownConnectionIds || failed ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pages.isFetching || submitting}
              onClick={() => void pages.refetch()}
            >
              Refresh connections
            </Button>
          ) : null}
          {pages.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pages.isFetching || submitting}
              onClick={() => void pages.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      ) : null}
      {canDetach &&
      last &&
      (result?.status === "unavailable" ||
        (result?.status === "ok" &&
          result.value.remoteFenceDelivery === "remote_pending")) ? (
        <Button
          variant="outline"
          size="sm"
          disabled={submitting || !readDetach}
          onClick={() => void submit(last.request, true)}
        >
          Check original request
        </Button>
      ) : null}
      <Dialog.Root
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirming(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup
            finalFocus={() =>
              selection?.returnFocus?.isConnected ? selection.returnFocus : true
            }
          >
            <Dialog.Title>
              {accountsCopy.detach} · {selection?.label}
            </Dialog.Title>
            <Dialog.Description>
              {
                removeFromWorkspaceCopy.description[
                  selection?.ownerKind ?? "unknown"
                ]
              }
            </Dialog.Description>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!canDetach || submitting || !confirming || !selection}
                onClick={() => {
                  if (selection) void submit(selection.request);
                }}
              >
                {removeFromWorkspaceCopy.confirm}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
