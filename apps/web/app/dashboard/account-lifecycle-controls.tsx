"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog } from "@reviewrouter/ui";
import type {
  AccountView,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import type {
  AccountLifecycleRequest,
  AccountLifecycleView,
} from "../../src/server/account-lifecycle";
import {
  accountLifecycleApi as defaultApi,
  type AccountLifecycleApi,
} from "./account-lifecycle-api";
export type { AccountLifecycleApi } from "./account-lifecycle-api";
import {
  AccountMenuItem,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import { accountsCopy } from "./accounts-copy";

type Action = AccountLifecycleRequest["action"];
type Journal = {
  connectionId: string;
  workspaceId: string;
  request?: AccountLifecycleRequest;
  operationId?: string;
  receipt?: AccountLifecycleView;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const terminal = (receipt: AccountLifecycleView | undefined) =>
  !!receipt &&
  (receipt.phase === "rejected" ||
    (receipt.phase === "applied" &&
      (receipt.action !== "delete" || receipt.closureComplete)));
const actionText = (action: Action) =>
  action === "suspend"
    ? accountsCopy.suspend
    : action === "resume"
      ? accountsCopy.resume
      : accountsCopy.deleteConnection;
function resultText(
  receipt: AccountLifecycleView | undefined,
  action?: Action,
): string {
  if (receipt?.phase === "rejected")
    return "Изменение отклонено. Обновите сведения перед новым подтверждением.";
  if (
    receipt?.action === "delete" &&
    receipt.phase === "applied" &&
    receipt.closureComplete
  )
    return "Подключение удалено; очистка и прекращение использования подтверждены.";
  if (receipt?.action === "delete" || action === "delete")
    return "Удаляем… Завершение удаления и очистки пока не подтверждено.";
  if (receipt?.phase === "applied")
    return receipt.action === "resume"
      ? "Подключение включено. Действуют только текущие разрешения доступа."
      : "Подключение выключено. Учётные данные и разрешения сохранены.";
  return "Результат пока неизвестен. Проверяем исходную операцию; повторная отправка не выполняется.";
}
function restore(key: string, connectionId: string): Journal | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  if (raw.length > 4096) throw new Error("invalid_saved_operation");
  const value = JSON.parse(raw) as Journal;
  if (
    value.connectionId !== connectionId ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length > 256 ||
    (!value.operationId && !value.request)
  )
    throw new Error("invalid_saved_operation");
  if (
    value.request &&
    (!uuid.test(value.request.nonce) ||
      value.request.connectionId !== connectionId ||
      !["suspend", "resume", "delete"].includes(value.request.action) ||
      ![
        value.request.mirrorRevision,
        value.request.gatewayRevision,
        value.request.authorizationEpoch,
      ].every((n) => Number.isSafeInteger(n) && n > 0))
  )
    throw new Error("invalid_saved_operation");
  if (
    value.operationId &&
    (typeof value.operationId !== "string" || value.operationId.length > 256)
  )
    throw new Error("invalid_saved_operation");
  // Persisted UI data cannot prove completion. Re-read the original operation.
  return {
    connectionId,
    workspaceId: value.workspaceId,
    ...(value.request ? { request: value.request } : {}),
    ...(value.operationId ? { operationId: value.operationId } : {}),
  };
}
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
function accountQueries(client: QueryClient, viewerScope: string) {
  return client
    .getQueryCache()
    .getAll()
    .filter((query) => {
      const [kind, scope] = query.queryKey;
      if (kind === "personal-accounts") return scope === viewerScope;
      if (
        ["account-options", "account-option", "accounts-overview"].includes(
          String(kind),
        )
      )
        return (
          typeof scope === "string" &&
          scope.startsWith(`${viewerScope}:workspace:`)
        );
      // This QueryClient is owned by the authenticated viewer and cleared on identity change.
      return kind === "gateway-accounts";
    });
}
async function refreshScopes(
  client: QueryClient,
  viewerScope: string,
  connectionId: string,
  mode: "pending" | "refresh" | "deleted",
) {
  const queries = accountQueries(client, viewerScope);
  await Promise.all(
    queries.map((query) =>
      client.cancelQueries({ queryKey: query.queryKey, exact: true }),
    ),
  );
  if (mode !== "refresh")
    for (const query of queries)
      client.setQueryData(query.queryKey, (data: unknown) => {
        const transform = (value: unknown): unknown => {
          if (!value || typeof value !== "object") return value;
          if (Array.isArray(value)) return value.map(transform);
          const record = value as Record<string, unknown>;
          const detail = record.value as
            | { account?: { connectionId?: string } }
            | undefined;
          if (
            mode === "deleted" &&
            record.status === "ok" &&
            detail?.account?.connectionId === connectionId
          )
            return { status: "denied" };
          const copy = { ...record };
          for (const field of ["accounts", "sources"])
            if (Array.isArray(record[field]))
              copy[field] = record[field].flatMap(
                (raw: Record<string, unknown>) => {
                  if (
                    raw.connectionId !== connectionId &&
                    raw.sourceId !== connectionId
                  )
                    return [raw];
                  if (mode === "deleted") return [];
                  return [
                    {
                      ...raw,
                      readiness: "pending",
                      sourceOperationPending: true,
                    },
                  ];
                },
              );
          if (
            record.account &&
            typeof record.account === "object" &&
            (record.account as Record<string, unknown>).connectionId ===
              connectionId
          )
            copy.account = {
              ...record.account,
              readiness: mode === "deleted" ? "unavailable" : "pending",
              canManage: false,
            };
          for (const field of ["pages", "value"])
            if (record[field]) copy[field] = transform(record[field]);
          return copy;
        };
        return transform(data);
      });
  if (mode !== "pending")
    await Promise.all(
      queries.map((query) =>
        client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
      ),
    );
}

export function AccountLifecycleControls({
  account,
  context,
  workspaceId,
  client,
  api = defaultApi,
  accessSummary,
}: {
  account: AccountView;
  context: string;
  workspaceId: string;
  client: QueryClient;
  api?: AccountLifecycleApi;
  accessSummary?:
    | { organizationCount: number; hasRestrictedAccess: boolean }
    | undefined;
}) {
  const menuReturnFocus = useAccountMenuReturnFocus();
  const cancel = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{
    label: string;
    workspaceId: string;
    request: Omit<AccountLifecycleRequest, "nonce">;
  } | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [journal, setJournal] = useState<Journal | null>(null);
  const current = useRef<Journal | null>(null);
  const busyRef = useRef(false);
  const readBarrier = useRef(0);
  const [uncertainContinuation, setUncertainContinuation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [authorityDenied, setAuthorityDenied] = useState(false);
  const storageKey = `rr-account-lifecycle:${context}:${account.connectionId}`;
  const owned =
    (account.canManage === true || account.isOwnedByViewer === true) &&
    Boolean(context && workspaceId);
  const publish = useCallback(
    (value: Journal) => {
      current.current = value;
      setJournal(value);
      client.setQueryData(
        ["account-lifecycle-activity", context, account.connectionId],
        {
          pending: !terminal(value.receipt),
          action: value.receipt?.action ?? value.request?.action,
        },
      );
      try {
        if (terminal(value.receipt)) {
          sessionStorage.removeItem(storageKey);
          return;
        }
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            connectionId: value.connectionId,
            workspaceId: value.workspaceId,
            request: value.request,
            operationId: value.operationId,
          }),
        );
      } catch {
        /* Preserve the mounted original; read-only recovery remains safe. */
      }
    },
    [account.connectionId, client, context, storageKey],
  );
  useEffect(() => {
    if (!owned) {
      setLoaded(true);
      return;
    }
    try {
      const prior =
        current.current ?? restore(storageKey, account.connectionId);
      const serverOperation = account.lifecycle?.operationId;
      const next =
        serverOperation &&
        (!prior ||
          (terminal(prior.receipt) && serverOperation !== prior.operationId))
          ? {
              connectionId: account.connectionId,
              workspaceId,
              operationId: serverOperation,
            }
          : prior;
      if (next) publish(next);
      setLoaded(true);
    } catch {
      setMessage(
        "Не удалось восстановить исходную операцию. Проверьте доступ к хранилищу этой вкладки.",
      );
    }
  }, [
    account.connectionId,
    account.lifecycle?.operationId,
    owned,
    publish,
    storageKey,
    workspaceId,
  ]);
  const pending = !!journal && !terminal(journal.receipt);
  const readKey = [
    "account-lifecycle-operation",
    context,
    account.connectionId,
    journal?.request?.nonce ?? journal?.operationId ?? "none",
  ] as const;
  const mutation = useMutation(
    {
      mutationKey: [
        "account-lifecycle-mutation",
        context,
        account.connectionId,
      ],
      mutationFn: (original: Journal) =>
        api.mutate(context, original.workspaceId, original.request!),
      retry: false,
      gcTime: 0,
    },
    client,
  );
  const continuation = useMutation(
    {
      mutationKey: [
        "account-lifecycle-continue",
        context,
        account.connectionId,
      ],
      mutationFn: (original: Journal) =>
        api.continue(context, original.workspaceId, original.operationId!),
      retry: false,
      gcTime: 0,
    },
    client,
  );
  const read = useQuery(
    {
      queryKey: readKey,
      queryFn: () => {
        const original = current.current!;
        return api.read(
          context,
          original.workspaceId,
          original.operationId
            ? { operationId: original.operationId }
            : { nonce: original.request!.nonce },
        );
      },
      enabled: owned && loaded && pending && !busy,
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
      refetchInterval: (query) => {
        const result = query.state.data;
        return pending &&
          result?.status !== "denied" &&
          result?.status !== "invalid"
          ? 3000
          : false;
      },
    },
    client,
  );
  const accept = useCallback(
    async (result: AccountsResult<AccountLifecycleView>) => {
      const original = current.current;
      if (!original) return;
      if (result.status !== "ok") {
        if (result.status === "denied" || result.status === "invalid")
          setAuthorityDenied(true);
        setMessage(
          result.status === "denied"
            ? "Право на чтение изменилось. Исходная операция сохранена; новый запрос не отправлен."
            : "Результат пока неизвестен. Проверьте исходную операцию.",
        );
        return;
      }
      setAuthorityDenied(false);
      const receipt = result.value;
      if (
        !uuid.test(receipt.nonce) ||
        !receipt.operationId ||
        ![
          "fencing",
          "ready",
          "submitted",
          "unknown",
          "rejected",
          "applied",
        ].includes(receipt.phase) ||
        typeof receipt.closureComplete !== "boolean"
      ) {
        setMessage("Ответ не подтверждает исходную операцию.");
        return;
      }
      if (
        (original.request &&
          (receipt.nonce !== original.request.nonce ||
            receipt.action !== original.request.action)) ||
        (original.operationId && receipt.operationId !== original.operationId)
      ) {
        setMessage("Ответ не подтверждает исходную операцию.");
        return;
      }
      const progress = {
        fencing: 0,
        ready: 1,
        submitted: 2,
        unknown: 2,
        rejected: 3,
        applied: 3,
      };
      if (
        original.receipt &&
        progress[receipt.phase] < progress[original.receipt.phase]
      )
        return;
      setUncertainContinuation(false);
      if (
        (terminal(original.receipt) && !terminal(receipt)) ||
        JSON.stringify(original.receipt) === JSON.stringify(receipt)
      )
        return;
      publish({ ...original, operationId: receipt.operationId, receipt });
      setMessage(resultText(receipt));
      const deleted =
        receipt.action === "delete" &&
        receipt.phase === "applied" &&
        receipt.closureComplete;
      await refreshScopes(
        client,
        context,
        account.connectionId,
        deleted ? "deleted" : "refresh",
      );
      if (deleted) {
        const heading =
          document.getElementById("personal-accounts-panel-title") ??
          document.getElementById("workspace-accounts-title");
        if (heading) {
          heading.tabIndex = -1;
          requestAnimationFrame(() => heading.focus());
        }
      }
    },
    [account.connectionId, client, context, publish],
  );
  useEffect(() => {
    if (read.data && !busy && read.dataUpdatedAt > readBarrier.current) {
      void accept(read.data).catch(() =>
        setMessage(
          "Не удалось обновить сведения. Исходная операция сохранена.",
        ),
      );
    }
  }, [accept, busy, read.data, read.dataUpdatedAt]);
  async function sendOriginal(original: Journal) {
    if (!original.request || busyRef.current) return;
    readBarrier.current = Date.now();
    busyRef.current = true;
    setBusy(true);
    publish(original);
    try {
      await refreshScopes(client, context, account.connectionId, "pending");
      let result: AccountsResult<AccountLifecycleView>;
      try {
        result = await mutation.mutateAsync(original);
      } catch {
        result = { status: "unavailable" };
      }
      await client.cancelQueries({
        queryKey: [
          "account-lifecycle-operation",
          context,
          account.connectionId,
        ],
        exact: false,
      });
      await accept(result);
      if (result.status !== "ok")
        await refreshScopes(client, context, account.connectionId, "refresh");
    } catch {
      setMessage("Результат пока неизвестен. Проверьте исходную операцию.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function continueOriginal() {
    const original = current.current;
    if (
      !original?.operationId ||
      !["fencing", "ready"].includes(original.receipt?.phase ?? "") ||
      busyRef.current
    )
      return;
    readBarrier.current = Date.now();
    setUncertainContinuation(true);
    busyRef.current = true;
    setBusy(true);
    setRecoveryOpen(true);
    try {
      let result: AccountsResult<AccountLifecycleView>;
      await client.cancelQueries({
        queryKey: [
          "account-lifecycle-operation",
          context,
          account.connectionId,
        ],
      });
      try {
        result = await continuation.mutateAsync(original);
      } catch {
        result = { status: "unavailable" };
      }
      await client.cancelQueries({
        queryKey: [
          "account-lifecycle-operation",
          context,
          account.connectionId,
        ],
      });
      await accept(result);
    } catch {
      setMessage("Результат пока неизвестен. Проверьте исходную операцию.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!selection || pending || busyRef.current) return;
    const request = { ...selection.request, nonce: crypto.randomUUID() };
    const original: Journal = {
      connectionId: account.connectionId,
      workspaceId: selection.workspaceId,
      request,
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(original));
    } catch {
      setMessage(
        "Операция не отправлена: не удалось сохранить её исходный номер в этой вкладке.",
      );
      return;
    }
    await sendOriginal(original);
  }
  function open(action: Action) {
    if (pending) return;
    current.current = null;
    setJournal(null);
    setMessage("");
    setSelection({
      label: account.label,
      workspaceId,
      request: {
        action,
        connectionId: account.connectionId,
        mirrorRevision: account.mirrorRevision,
        gatewayRevision: account.gatewayRevision,
        authorizationEpoch: account.authorizationEpoch!,
      },
    });
  }
  const actions =
    !authorityDenied &&
    owned &&
    account.lifecycle?.status === "available" &&
    !pending &&
    loaded &&
    Number.isSafeInteger(account.authorizationEpoch) &&
    account.authorizationEpoch! > 0
      ? (["suspend", "resume", "delete"] as const).filter((action) =>
          account.allowedActions?.includes(action),
        )
      : [];
  if (!owned || !context || !workspaceId) return null;
  return (
    <>
      {actions.map((action) => (
        <AccountMenuItem key={action}>
          <Button
            variant="ghost"
            size="sm"
            className={action === "delete" ? "text-rose-300" : undefined}
            onClick={() => open(action)}
          >
            {actionText(action)}
          </Button>
        </AccountMenuItem>
      ))}
      {journal ? (
        <AccountMenuItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || read.isFetching}
            onClick={() => {
              setRecoveryOpen(true);
              void read.refetch();
            }}
          >
            Проверить исходную операцию
          </Button>
        </AccountMenuItem>
      ) : null}
      {(journal?.receipt?.phase === "ready" ||
        journal?.receipt?.phase === "fencing") &&
      journal.operationId &&
      !uncertainContinuation &&
      !authorityDenied ? (
        <AccountMenuItem>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setRecoveryOpen(true);
              void continueOriginal();
            }}
          >
            Продолжить исходное действие
          </Button>
        </AccountMenuItem>
      ) : null}
      {message && !journal && !selection ? (
        <p role="status" className="max-w-64 p-2 text-xs text-slate-400">
          {message}
        </p>
      ) : null}
      {account.lifecycle?.status === "support_required" ? (
        <p className="max-w-64 p-2 text-xs text-slate-400">
          Очистка прежнего отключения не подтверждена. Восстановление требует
          проверки исходной операции.
        </p>
      ) : null}
      <Dialog.Root
        open={!!selection || recoveryOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSelection(null);
            setRecoveryOpen(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="z-[60]" />
          <Dialog.Popup
            initialFocus={cancel}
            finalFocus={menuReturnFocus}
            className="z-[61] max-h-[calc(100dvh-2rem)] overflow-y-auto"
          >
            <Dialog.Title className="text-lg font-semibold">
              {selection
                ? actionText(selection.request.action)
                : "Изменение подключения"}{" "}
              · {selection?.label ?? account.label}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-slate-400">
              {!selection
                ? "Проверка исходной операции изменения подключения. Новый запрос не создаётся."
                : selection?.request.action === "delete"
                  ? "Удаляется подключение ReviewRouter, а не аккаунт у провайдера. Использование через это подключение во всех workspace будет прекращено. Удаление необратимо; завершение очистки подтверждается отдельно."
                  : selection?.request.action === "resume"
                    ? "Разрешить новые review через то же подключение и сохранённые учётные данные. Действуют только текущие разрешения доступа; отозванные доступы и старые запросы не восстанавливаются."
                    : "Остановить новые review через это подключение во всех workspace. Учётные данные и разрешения сохраняются. Уже отправленный запрос провайдеру может завершиться."}
            </Dialog.Description>
            {selection?.request.action === "delete" && accessSummary ? (
              <p className="mt-3 text-sm">
                Организаций с видимым доступом:{" "}
                {accessSummary.organizationCount}.
                {accessSummary.hasRestrictedAccess
                  ? ` ${accountsCopy.privacy}.`
                  : ""}
              </p>
            ) : null}
            {journal || message ? (
              <p role="status" className="mt-4 text-sm">
                {message ||
                  resultText(journal?.receipt, journal?.request?.action)}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                ref={cancel}
                variant="outline"
                onClick={() => {
                  setSelection(null);
                  setRecoveryOpen(false);
                }}
              >
                {pending || terminal(journal?.receipt) ? "Закрыть" : "Отмена"}
              </Button>
              {pending &&
              (journal?.receipt?.phase === "ready" ||
                journal?.receipt?.phase === "fencing") &&
              journal.operationId &&
              !uncertainContinuation &&
              !authorityDenied ? (
                <Button disabled={busy} onClick={() => void continueOriginal()}>
                  Продолжить исходное действие
                </Button>
              ) : null}
              {pending ? (
                <Button
                  variant="outline"
                  disabled={busy || read.isFetching}
                  onClick={() => void read.refetch()}
                >
                  Проверить исходную операцию
                </Button>
              ) : terminal(journal?.receipt) ? null : (
                <Button
                  className={
                    selection?.request.action === "delete"
                      ? "border-rose-400/50 text-rose-200"
                      : undefined
                  }
                  disabled={busy || !selection}
                  onClick={() => void confirm()}
                >
                  {selection?.request.action === "delete"
                    ? "Удалить подключение навсегда"
                    : "Подтвердить"}
                </Button>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
