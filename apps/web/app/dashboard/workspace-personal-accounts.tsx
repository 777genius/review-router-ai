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
} from "./account-actions-menu";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { AccountIdentity } from "./account-identity";
import { AccountUsageLine } from "./account-usage-line";
import { readAccountResult } from "./account-read-result";
import { useOwnAccountsView } from "./accounts-workspace-tabs";
import { accountsGridColumns } from "./accounts-grid";
import {
  accountsCopy,
  accountStatusInfo,
  pendingStatusCopy,
} from "./accounts-copy";
import { AccountStatusLine } from "./account-status-icon";

import type {
  AccountView,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import { dashboardSectionHref } from "./dashboard-section";
import { refreshPersonalAccountViews } from "./personal-account-controls";
import {
  useGatewayModelAccountsQueryClient,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";

type DetachRequest = { bindingId: string; expectedBindingRevision: number };
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

function AccountOwner({ account }: { account: AccountView }) {
  const owner = account.owner;
  const avatarUrl =
    owner?.kind === "personal" || owner?.kind === "organization"
      ? owner.avatarUrl
      : null;
  const avatarLabel =
    owner?.kind === "personal"
      ? (owner.handle ?? "Owner")
      : owner?.kind === "organization"
        ? owner.label
        : "Owner";
  const text =
    owner?.kind === "personal"
      ? owner.isViewer
        ? "You"
        : owner.handle
          ? `@${owner.handle}`
          : accountsCopy.ownerUnavailable
      : owner?.kind === "organization"
        ? owner.label
        : owner?.kind === "operator"
          ? owner.label
          : account.origin === "organization"
            ? "This workspace"
            : account.origin === "operator"
              ? "ReviewRouter"
              : accountsCopy.ownerUnavailable;
  return (
    <p className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-400">
      {avatarUrl ? (
        <GitHubAccountAvatar
          avatarUrl={avatarUrl}
          login={avatarLabel}
          altText=""
          size="sm"
        />
      ) : null}
      <span className="truncate">{text}</span>
    </p>
  );
}

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
  selectDetach(): void;
}) {
  const showOwn = useOwnAccountsView();
  const managed = managementRows.find(
    (row) => row.connectionId === account.connectionId,
  );
  const canDetachRow =
    canDetach &&
    account.binding?.state === "active" &&
    account.allowedActions?.includes("detach");
  return (
    <AccountActionsMenu label={account.label}>
      {account.isOwnedByViewer && showOwn ? (
        <AccountMenuItem>
          <Button
            variant="ghost"
            size="sm"
            className={accountMenuItemClass}
            onClick={showOwn}
          >
            {accountsCopy.own}
          </Button>
        </AccountMenuItem>
      ) : null}
      {managed && managementActions ? managementActions(managed) : null}
      <AccountLifecycleControls
        account={account}
        context={lifecycleContext}
        workspaceId={workspaceId ?? ""}
        client={client}
        usage={account.usage}
      />
      {canDetachRow ? (
        <AccountMenuItem>
          <Button
            variant="ghost"
            size="sm"
            className={accountMenuItemClass}
            onClick={selectDetach}
          >
            {accountsCopy.detach}
          </Button>
        </AccountMenuItem>
      ) : null}
    </AccountActionsMenu>
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
        queryKey: ["accounts-overview", scope],
        exact: true,
      });
      await removeAccountLimits(client, limitsScope);
      if (!current) return;
      const first = extractAccountLimits(client, limitsScope, initialPage);
      hydratedBootstrap.current = initialPage;
      client.setQueryData<
        InfiniteData<AccountsResult<AccountsPage>, string | null>
      >(["accounts-overview", scope], { pages: [first], pageParams: [null] });
    })();
    return () => {
      current = false;
    };
  }, [client, limitsScope, initialPage, scope]);
  const pageKey = ["accounts-overview", scope] as const;
  const [selection, setSelection] = useState<{
    label: string;
    request: DetachRequest | null;
  } | null>(null);
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
      setSelection(null);
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
                            accounts: page.value.accounts.filter(
                              (row) => row.binding?.id !== original.bindingId,
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
      ? result.value.remoteFenceDelivery === "remote_pending"
        ? "Access revoked locally in this organization; gateway confirmation pending."
        : "Access revoked in this organization; gateway confirmation received."
      : result?.status === "conflict"
        ? "This binding changed. Refresh and confirm the current selection."
        : result?.status === "denied"
          ? "Your access changed. Refresh to see the available actions."
          : result
            ? "Detachment could not be confirmed. Check the original request."
            : null;
  return (
    <section aria-label="Available connections">
      {pages.isPending ? <p role="status">Loading connections...</p> : null}
      {failed ? (
        <p role="status">Connections could not be refreshed. Try again.</p>
      ) : null}
      {!pages.isPending && !failed && !accounts.length ? (
        <p>
          {pages.hasNextPage
            ? "No available connections on the loaded pages."
            : "No available connections."}
        </p>
      ) : null}
      <div
        className={`hidden gap-3 border-b border-cyan-200/15 py-2 text-xs uppercase tracking-wider text-slate-400 lg:grid ${accountsGridColumns}`}
        aria-hidden="true"
      >
        <span>Account</span>
        <span>Owner</span>
        <span>Status</span>
        <span />
      </div>
      {(denied ? [] : accounts).map((row) => (
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
              connection={row.connection}
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
          <p className="text-sm text-slate-300">
            <AccountStatusLine
              {...(failed
                ? { kind: "unknown", text: "Details could not be refreshed" }
                : lifecycleActivities.get(row.connectionId) === "delete"
                  ? { kind: "removing", text: pendingStatusCopy.removing }
                  : lifecycleActivities.has(row.connectionId)
                    ? { kind: "confirming", text: pendingStatusCopy.confirming }
                    : !row.binding && row.canManage
                      ? { kind: "unknown", text: "Not added here" }
                      : accountStatusInfo(row))}
            />
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!failed &&
            !lifecycleActivities.has(row.connectionId) &&
            row.readiness === "ready" &&
            row.binding?.state === "active" &&
            !row.binding.fencePending ? (
              <a
                className="text-sm text-cyan-200 underline"
                href={dashboardSectionHref("policy", workspaceId)}
              >
                Choose in Models
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={failed}
              onClick={() =>
                setSelection({
                  label: row.label,
                  request:
                    canDetach &&
                    row.binding?.state === "active" &&
                    row.allowedActions?.includes("detach")
                      ? {
                          bindingId: row.binding.id,
                          expectedBindingRevision: row.binding.revision,
                        }
                      : null,
                })
              }
            >
              {accountsCopy.access}
            </Button>
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
                selectDetach={() =>
                  setSelection({
                    label: row.label,
                    request:
                      row.binding?.state === "active"
                        ? {
                            bindingId: row.binding.id,
                            expectedBindingRevision: row.binding.revision,
                          }
                        : null,
                  })
                }
              />
            ) : null}
          </div>
        </article>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pages.isFetching || submitting}
          onClick={() => void pages.refetch()}
        >
          Refresh connections
        </Button>
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
        open={Boolean(selection)}
        onOpenChange={(open) => {
          if (!open && !submitting) setSelection(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>
              {accountsCopy.access} · {selection?.label}
            </Dialog.Title>
            <Dialog.Description>
              Access only covers reviews in this organization. Your personal
              account and other organizations stay unchanged. Ownership,
              credentials, and control are not transferred.
            </Dialog.Description>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => setSelection(null)}
              >
                Close
              </Button>
              <Button
                disabled={!canDetach || submitting || !selection?.request}
                onClick={() => {
                  if (selection?.request) void submit(selection.request);
                }}
              >
                Revoke access
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
