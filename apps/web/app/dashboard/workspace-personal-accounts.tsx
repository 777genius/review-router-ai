"use client";

import {
  AccountLifecycleControls,
  useAccountLifecycleActivities,
} from "./account-lifecycle-controls";

import { useRef, useState } from "react";
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
} from "@tanstack/react-query";
import { Button, Dialog } from "@reviewrouter/ui";
import { AccountActionsMenu, AccountMenuItem } from "./account-actions-menu";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { AccountIdentity } from "./account-identity";
import { useOwnAccountsView } from "./accounts-workspace-tabs";
import { accountsCopy, accountStatus } from "./accounts-copy";

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
  const text =
    owner?.kind === "personal"
      ? owner.isViewer
        ? "Вы"
        : owner.handle
          ? `@${owner.handle}`
          : accountsCopy.ownerUnavailable
      : owner?.kind === "organization"
        ? owner.label
        : owner?.kind === "operator"
          ? owner.label
          : account.origin === "organization"
            ? "Этот workspace"
            : account.origin === "operator"
              ? "ReviewRouter"
              : accountsCopy.ownerUnavailable;
  return (
    <p className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-400">
      {owner?.kind === "personal" && owner.avatarUrl ? (
        <GitHubAccountAvatar
          avatarUrl={owner.avatarUrl}
          login={owner.handle ?? "Владелец"}
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
          <Button variant="ghost" size="sm" onClick={showOwn}>
            Мои подключения
          </Button>
        </AccountMenuItem>
      ) : null}
      {managed && managementActions ? managementActions(managed) : null}
      <AccountLifecycleControls
        account={account}
        context={lifecycleContext}
        workspaceId={workspaceId ?? ""}
        client={client}
      />
      {canDetachRow ? (
        <AccountMenuItem>
          <Button variant="ghost" size="sm" onClick={selectDetach}>
            Убрать из этого workspace
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
        ? { initialData: { pages: [initialPage], pageParams: [null] } }
        : {}),
      queryFn: ({ pageParam }) =>
        api.list({
          limit: 25,
          ...(pageParam ? { afterBindingId: pageParam } : {}),
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
  const fetched = pages.data?.pages ?? [];
  const failed = pages.isError || fetched.some((p) => p.status !== "ok");
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
    <section aria-label="Доступные подключения">
      {pages.isPending ? <p role="status">Загрузка подключений...</p> : null}
      {failed ? (
        <p role="status">
          Не удалось обновить подключения. Повторите обновление.
        </p>
      ) : null}
      {!pages.isPending && !failed && !accounts.length ? (
        <p>
          {pages.hasNextPage
            ? "На загруженных страницах нет доступных подключений."
            : "Нет доступных подключений."}
        </p>
      ) : null}
      <div
        className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_auto] gap-3 border-b border-cyan-200/15 py-2 text-xs uppercase tracking-wider text-slate-400 lg:grid"
        aria-hidden="true"
      >
        <span>Аккаунт</span>
        <span>Владелец</span>
        <span>Состояние</span>
        <span className="w-28" />
      </div>
      {(failed ? [] : accounts).map((row) => (
        <article
          key={row.connectionId}
          aria-label={row.label}
          className="grid min-w-0 items-center gap-3 border-b border-cyan-200/10 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_auto]"
        >
          <div className="min-w-0">
            <AccountIdentity
              label={row.label}
              profileLabel={row.profileLabel}
              authKind={row.authKind}
            />
          </div>
          <AccountOwner account={row} />
          <p className="text-sm text-slate-300">
            {lifecycleActivities.get(row.connectionId) === "delete"
              ? "Удаляем…"
              : lifecycleActivities.has(row.connectionId)
                ? "Подтверждаем изменение"
                : !row.binding && row.canManage
                  ? "Не добавлен сюда"
                  : accountStatus(row)}
          </p>
          <div className="flex items-center gap-2">
            {!lifecycleActivities.has(row.connectionId) &&
            row.readiness === "ready" &&
            row.binding?.state === "active" &&
            !row.binding.fencePending ? (
              <a
                className="text-sm text-cyan-200 underline"
                href={dashboardSectionHref("policy", workspaceId)}
              >
                Выбрать для отзывов
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
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
              Доступ
            </Button>
            {managementActions ||
            canDetach ||
            row.canManage ||
            row.isOwnedByViewer ? (
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
          Обновить подключения
        </Button>
        {pages.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pages.isFetching || submitting}
            onClick={() => void pages.fetchNextPage()}
          >
            Загрузить ещё
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
          Проверить исходный запрос
        </Button>
      ) : null}
      <Dialog.Root
        open={Boolean(selection)}
        onOpenChange={(open) => {
          if (!open && !submitting) setSelection(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="z-[60]" />
          <Dialog.Popup className="z-[61] max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <Dialog.Title>Доступ · {selection?.label}</Dialog.Title>
            <Dialog.Description>
              Доступ действует только для отзывов в этой организации. Личный
              аккаунт и другие организации не изменяются. Владение, учётные
              данные и управление не передаются.
            </Dialog.Description>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => setSelection(null)}
              >
                Закрыть
              </Button>
              <Button
                disabled={!canDetach || submitting || !selection?.request}
                onClick={() => {
                  if (selection?.request) void submit(selection.request);
                }}
              >
                Отозвать доступ
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
