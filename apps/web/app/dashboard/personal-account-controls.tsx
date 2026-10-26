"use client";

import {
  AccountLimitsLine,
  AccountLimitsReadContext,
} from "./account-limits-line";
import {
  accountLimitsScope,
  removeAccountLimitsForConnection,
} from "./account-limits-query";

import {
  AccountLifecycleControls,
  useAccountLifecycleActivities,
} from "./account-lifecycle-controls";

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog } from "@reviewrouter/ui";
import { AccountIdentity } from "./account-identity";
import { readAccountResult } from "./account-read-result";
import { AccountActionsMenu } from "./account-actions-menu";
import { accountsGridColumns } from "./accounts-grid";
import {
  accountsCopy,
  accountStatusInfo,
  pendingStatusCopy,
  type AccountStatusInfo,
} from "./accounts-copy";
import { AccountStatusLine } from "./account-status-icon";

import type { AccountView } from "../../src/server/account-gateway-accounts";
import { dashboardSectionHref } from "./dashboard-section";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import { readOwnAccessSummaries } from "../../src/features/account-gateway/personal-accounts";
import type {
  OwnAccountGrant,
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
  PersonalAccountsResult,
  PersonalAccessSummary,
  PersonalAttachRequest,
  PersonalMutationReceipt,
  PersonalRevokeRequest,
  PersonalSource,
} from "../../src/features/account-gateway/personal-accounts";

const keys = {
  sources: (scope: string) => ["personal-accounts", scope, "sources"] as const,
  grants: (scope: string, sourceId: string) =>
    ["personal-accounts", scope, "grants", sourceId] as const,
  accessSummaries: (scope: string, sourceIds: readonly string[]) =>
    ["personal-accounts", scope, "access-summaries", ...sourceIds] as const,
  organizations: (scope: string, sourceIds: readonly string[]) =>
    ["personal-accounts", scope, "organizations", ...sourceIds] as const,
  operation: (scope: string, nonce: string) =>
    ["personal-accounts", scope, "operation", nonce] as const,
};
export async function refreshPersonalAccountViews(
  client: QueryClient,
  scope: string,
  includeManagement = true,
) {
  const canonicalScope = `personal:${scope.split(".")[0] ?? ""}`;
  const queries = client
    .getQueryCache()
    .getAll()
    .filter(
      (query) =>
        (query.queryKey[0] === "personal-accounts" &&
          query.queryKey[1] === scope &&
          ["sources", "grants", "organizations", "access-summaries"].includes(
            String(query.queryKey[2]),
          )) ||
        (["accounts-overview", "account-options", "account-option"].includes(
          String(query.queryKey[0]),
        ) &&
          typeof query.queryKey[1] === "string" &&
          query.queryKey[1].startsWith(`${scope}:workspace:`)) ||
        (includeManagement &&
          query.queryKey[0] === "gateway-accounts" &&
          query.queryKey[1] === canonicalScope &&
          query.queryKey[2] === "page"),
    );
  await Promise.all(
    queries.map((query) =>
      client.cancelQueries({ queryKey: query.queryKey, exact: true }),
    ),
  );
  await Promise.all(
    queries.map((query) =>
      client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
    ),
  );
}

const noncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type PairContext = { sourceId: string; workspaceId: string } & (
  | { kind: "attach" }
  | { kind: "revoke"; bindingId: string }
);
function savedPairs(
  key: string,
  nonces: readonly string[],
): Record<string, PairContext> {
  const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const result: Record<string, PairContext> = {};
  for (const nonce of nonces) {
    const pair = (saved as Record<string, unknown>)[nonce];
    if (!pair || typeof pair !== "object") continue;
    const value = pair as Record<string, unknown>;
    if (
      typeof value.sourceId !== "string" ||
      typeof value.workspaceId !== "string" ||
      value.sourceId.length > 256 ||
      value.workspaceId.length > 256
    )
      continue;
    if (value.kind === "attach")
      result[nonce] = {
        kind: "attach",
        sourceId: value.sourceId,
        workspaceId: value.workspaceId,
      };
    if (
      value.kind === "revoke" &&
      typeof value.bindingId === "string" &&
      value.bindingId.length <= 256
    )
      result[nonce] = {
        kind: "revoke",
        sourceId: value.sourceId,
        workspaceId: value.workspaceId,
        bindingId: value.bindingId,
      };
  }
  return result;
}
function workspaceKey(): string {
  return typeof window === "undefined"
    ? ""
    : (new URL(window.location.href).searchParams.get("workspace") ?? "");
}
function errorText(status: string) {
  return status === "conflict"
    ? "This selection changed. Refresh and confirm a new selection."
    : status === "denied"
      ? "Your access changed. Refresh to see the actions still available."
      : status === "invalid"
        ? "Check your selection before continuing."
        : "Status unavailable. Check the original operation before trying again.";
}
function receiptText(receipt: PersonalMutationReceipt) {
  if (receipt.remoteFenceDelivery === "remote_pending")
    return "Use revoked locally; gateway confirmation pending.";
  if (receipt.remoteFenceDelivery === "remote_applied")
    return "Use revoked; gateway confirmation received.";
  if (receipt.operation.available)
    return "Account attached. Choose it in Models to use it for reviews.";
  if (receipt.operation.phase === "rejected")
    return "Request declined. Refresh before making a new selection.";
  return "Request recorded; completion is not confirmed. Check status.";
}
function isTerminalReceipt(receipt: PersonalMutationReceipt) {
  return (
    receipt.remoteFenceDelivery === "remote_applied" ||
    receipt.operation.phase === "rejected" ||
    receipt.operation.available
  );
}

// Deliberately inert unless the server supplies both the accepted H gate and
// authenticated actions. This component never discovers or enables the feature.
export function PersonalAccountControls({
  bootstrap,
  api,
  queryClient,
  managementRows = [],
  managementActions,
  currentWorkspaceId,
}: {
  bootstrap?: PersonalAccountsBootstrap;
  api?: PersonalAccountsApi;
  queryClient?: QueryClient;
  currentWorkspaceId?: string | undefined;
  managementRows?: readonly AccountView[];
  managementActions?: (account: AccountView) => ReactNode;
}) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  if (!bootstrap?.enabled || !api) return null;
  return (
    <QueryClientProvider client={client}>
      <PersonalControls
        key={bootstrap.scope}
        bootstrap={bootstrap}
        api={api}
        currentWorkspaceId={currentWorkspaceId}
        managementRows={managementRows}
        managementActions={managementActions}
      />
    </QueryClientProvider>
  );
}

function PersonalControls({
  bootstrap,
  api,
  managementRows,
  managementActions,
  currentWorkspaceId,
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
  currentWorkspaceId: string | undefined;
  managementRows: readonly AccountView[];
  managementActions: ((account: AccountView) => ReactNode) | undefined;
}) {
  const client = useQueryClient();
  const limitsContext = useContext(AccountLimitsReadContext);
  const lifecycleActivities = useAccountLifecycleActivities(client);
  const [selected, setSelected] = useState<
    readonly { sourceId: string; metadataRevision: number }[]
  >([]);
  const options = useCurrentGatewayModelAccountsCache();
  const [bulk, setBulk] = useState(false);
  const [resolvedNonces, setResolvedNonces] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [nonces, setNonces] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [sourceMessages, setSourceMessages] = useState<Record<string, string>>(
    {},
  );
  const [pairs, setPairs] = useState<
    Record<string, PairContext & { viewKey: string }>
  >({});
  const currentWorkspace = workspaceKey();

  const storageKey = `rr-personal-account-operations:${bootstrap.scope}`;
  const mutation = useMutation({
    mutationKey: ["personal-accounts", bootstrap.scope, "mutation"] as const,
    mutationFn: (
      request:
        | { kind: "attach"; intent: PersonalAttachRequest }
        | { kind: "revoke"; intent: PersonalRevokeRequest },
    ) =>
      request.kind === "attach"
        ? api.attach(request.intent)
        : api.revoke(request.intent),
    retry: false,
    gcTime: 0,
  });
  const sources = useInfiniteQuery({
    queryKey: keys.sources(bootstrap.scope),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      readAccountResult(
        api.listSources({
          ...(pageParam ? { afterSourceId: pageParam } : {}),
          limit: 25,
        }),
      ),
    initialData: { pages: [bootstrap.page], pageParams: [null] },
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    staleTime: 15000,
    retry: false,
  });
  const sourceDenied = sources.data.pages.some(
    (page) => page.status !== "ok" && page.status !== "unavailable",
  );
  const sourceRows = sourceDenied
    ? []
    : sources.data.pages.flatMap((page) =>
        page.status === "ok" ? page.value.sources : [],
      );
  const sourceFailure = sources.data.pages.find((page) => page.status !== "ok");
  const sourceIds = [
    ...new Set(sourceRows.map((source) => source.sourceId)),
  ].sort();
  const accessSummaries = useQuery({
    queryKey: keys.accessSummaries(bootstrap.scope, sourceIds),
    queryFn: () => readOwnAccessSummaries(api, sourceIds),
    enabled: sourceIds.length > 0,
    staleTime: 15000,
    retry: false,
  });
  const summaryBySource = new Map(
    accessSummaries.data?.status === "ok"
      ? accessSummaries.data.value.summaries.map((summary) => [
          summary.sourceId,
          summary,
        ])
      : [],
  );
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "[]",
      );
      if (
        !Array.isArray(saved) ||
        saved.length > 100 ||
        !saved.every(
          (nonce) => typeof nonce === "string" && noncePattern.test(nonce),
        )
      )
        throw new Error();
      const nonces = [...new Set(saved)] as string[];
      let restored: Record<string, PairContext> = {};
      try {
        restored = savedPairs(`${storageKey}:pairs`, nonces);
      } catch {
        /* Missing identity remains conservatively blocked. */
      }
      setPairs(
        Object.fromEntries(
          Object.entries(restored).map(([nonce, pair]) => [
            nonce,
            { ...pair, viewKey: workspaceKey() },
          ]),
        ),
      );
      setNonces(nonces);
      setStorageReady(true);
    } catch {
      setMessage(
        "Enable session storage to preserve operation status before sharing or revoking an account.",
      );
    }
  }, [storageKey]);
  function reserveNonce(pair: PairContext) {
    const nonce = crypto.randomUUID();
    const saved: unknown = JSON.parse(
      sessionStorage.getItem(storageKey) ?? "[]",
    );
    if (
      !Array.isArray(saved) ||
      saved.length >= 100 ||
      !saved.every(
        (value) => typeof value === "string" && noncePattern.test(value),
      )
    )
      throw new Error();
    const next = [...new Set([...saved, nonce])];
    // Opaque identity is persisted before nonce publication and request entry.
    // An uncertain request stays the same source/workspace pair after remount.
    const identities = savedPairs(`${storageKey}:pairs`, saved);
    sessionStorage.setItem(
      `${storageKey}:pairs`,
      JSON.stringify({ ...identities, [nonce]: pair }),
    );
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setNonces(next);
    return nonce;
  }
  const refresh = useCallback(async () => {
    await refreshPersonalAccountViews(client, bootstrap.scope);
    await options?.refresh();
  }, [client, bootstrap.scope, options]);
  const markResolved = useCallback((nonce: string, resolved: boolean) => {
    setResolvedNonces((prior) => {
      if (prior.has(nonce) === resolved) return prior;
      const next = new Set(prior);
      if (resolved) next.add(nonce);
      else next.delete(nonce);
      return next;
    });
  }, []);
  const readRefresh = useRef<{
    refresh: typeof refresh;
    dirty: boolean;
    promise: Promise<void>;
  } | null>(null);
  const busyReadRefresh = useRef<typeof refresh | null>(null);
  const mutationOwnedReceipts = useRef(new Set<string>());
  const queueReadRefresh = useCallback((refreshViews: () => Promise<void>) => {
    if (readRefresh.current?.refresh === refreshViews) {
      readRefresh.current.dirty = true;
      return readRefresh.current.promise;
    }
    const active = {
      refresh: refreshViews,
      dirty: false,
      promise: Promise.resolve(),
    };
    readRefresh.current = active;
    // Batch simultaneous receipts, then serialize a trailing refresh if a new
    // terminal receipt arrives after reads started. Never cancel one receipt's
    // refresh for another, or lose availability confirmed during those reads.
    active.promise = Promise.resolve().then(async () => {
      try {
        do {
          active.dirty = false;
          await refreshViews();
        } while (active.dirty);
      } finally {
        if (readRefresh.current === active) readRefresh.current = null;
      }
    });
    return active.promise;
  }, []);
  const refreshFromRead = useCallback(
    (nonce: string) => {
      if (mutationOwnedReceipts.current.has(nonce)) return Promise.resolve();
      if (busyRef.current) {
        busyReadRefresh.current = refresh;
        return Promise.resolve();
      }
      return queueReadRefresh(refresh);
    },
    [refresh, queueReadRefresh],
  );
  async function finishMutation() {
    let next: typeof refresh | null = refresh;
    try {
      while (next) {
        // Earlier receipts are covered by these reads. A terminal receipt
        // arriving during them must keep the latch and request a fresh tail.
        if (busyReadRefresh.current === next) busyReadRefresh.current = null;
        await queueReadRefresh(next);
        next = busyReadRefresh.current;
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function run(
    call: (nonce: string) => ReturnType<PersonalAccountsApi["attach"]>,
    pair: PairContext,
  ) {
    let nonce: string;
    try {
      nonce = reserveNonce(pair);
    } catch {
      setMessage(
        "Could not preserve operation status. Nothing was submitted. Hide completed results if the list is full.",
      );
      return;
    }
    // Keep only opaque intent references in this mounted view, never labels in
    // session storage. Names are resolved through current authorized queries.
    setPairs((prior) => ({
      ...prior,
      [nonce]: { ...pair, viewKey: currentWorkspace },
    }));
    let result: PersonalAccountsResult<PersonalMutationReceipt>;
    try {
      result = await call(nonce);
    } catch {
      result = { status: "unavailable" };
    }
    // A status read can start as soon as its saved nonce mounts. Cancel that
    // exact read before publishing the newer mutation receipt, so a delayed
    // pre-mutation response cannot replace an applied result with stale pending.
    await client.cancelQueries({
      queryKey: keys.operation(bootstrap.scope, nonce),
      exact: true,
    });
    // This receipt is already known before mutation-owned availability reads.
    // Its status observer must not mistake cache publication for a later read
    // transition and schedule a duplicate tail refresh.
    if (result.status === "ok" && isTerminalReceipt(result.value))
      mutationOwnedReceipts.current.add(nonce);
    client.setQueryData(keys.operation(bootstrap.scope, nonce), result);
    if (result.status === "conflict" || result.status === "invalid") {
      try {
        const saved: unknown = JSON.parse(
          sessionStorage.getItem(storageKey) ?? "[]",
        );
        if (!Array.isArray(saved)) throw new Error();
        const next = saved.filter((value) => value !== nonce);
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        setNonces(next);
      } catch {
        /* Keep the original identity if its removal could not be saved. */
      }
    }
    const text =
      result.status === "ok"
        ? receiptText(result.value)
        : errorText(result.status);
    setMessage(text);
    setSourceMessages((prior) => ({ ...prior, [pair.sourceId]: text }));
  }
  async function share(
    targets: readonly {
      workspaceId: string;
      predecessors?: readonly {
        sourceId: string;
        bindingId: string;
        revision: number;
      }[];
    }[],
    choices = selected,
  ) {
    if (busyRef.current) return;
    if (
      choices.some((choice) =>
        managementRows.some(
          (account) =>
            account.connectionId === choice.sourceId &&
            account.connection?.personalOnly,
        ),
      )
    )
      return;
    if (choices.some((source) => lifecycleActivities.has(source.sourceId))) {
      setMessage(
        "Confirming connection change. The new access has not been sent yet.",
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      // A finite set of independent operations, each with its own saved nonce.
      // Uncertain responses are read back, never resubmitted automatically.
      for (const source of choices)
        for (const target of targets) {
          if (
            client.getQueryData<{ pending: boolean }>([
              "account-lifecycle-activity",
              bootstrap.scope,
              source.sourceId,
            ])?.pending
          ) {
            setMessage(
              "Confirming connection change. The new access has not been sent yet.",
            );
            continue;
          }
          const predecessor = target.predecessors?.find(
            (row) => row.sourceId === source.sourceId,
          );
          await run(
            (nonce) =>
              mutation.mutateAsync({
                kind: "attach",
                intent: {
                  nonce,
                  sourceId: source.sourceId,
                  targetWorkspaceId: target.workspaceId,
                  expectedSourceMetadataRevision: source.metadataRevision,
                  predecessorBindingId: predecessor?.bindingId ?? null,
                  expectedPredecessorRevision: predecessor?.revision ?? null,
                },
              }),
            {
              kind: "attach",
              sourceId: source.sourceId,
              workspaceId: target.workspaceId,
            },
          );
        }
    } finally {
      await finishMutation();
    }
  }
  async function revoke(source: PersonalSource, grant: OwnAccountGrant) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await removeAccountLimitsForConnection(client, source.sourceId);
      await run(
        (nonce) =>
          mutation.mutateAsync({
            kind: "revoke",
            intent: {
              nonce,
              sourceId: source.sourceId,
              targetWorkspaceId: grant.targetWorkspaceId,
              expectedSourceMetadataRevision: source.metadataRevision,
              bindingId: grant.bindingId,
              expectedBindingRevision: grant.revision,
            },
          }),
        {
          kind: "revoke",
          sourceId: source.sourceId,
          workspaceId: grant.targetWorkspaceId,
          bindingId: grant.bindingId,
        },
      );
    } finally {
      await finishMutation();
    }
  }
  const selectionStale = selected.some(
    (selection) =>
      managementRows.some(
        (account) =>
          account.connectionId === selection.sourceId &&
          account.connection?.personalOnly,
      ) ||
      !sourceRows.some(
        (source) =>
          source.sourceId === selection.sourceId &&
          source.metadataRevision === selection.metadataRevision &&
          source.profileId !== null &&
          source.state === "active" &&
          !source.sourceOperationPending &&
          !lifecycleActivities.has(source.sourceId),
      ),
  );
  // Exact source identity only: a failed live management projection must not
  // hide an authorized source or its revocable organization grants.
  const sourcesById = new Map(
    sourceRows.map((source) => [source.sourceId, source]),
  );
  const managementById = new Map(
    managementRows.map((account) => [account.connectionId, account]),
  );
  const inventory = [
    ...new Set([...sourcesById.keys(), ...managementById.keys()]),
  ];
  const unresolved = nonces.some((nonce) => !resolvedNonces.has(nonce));
  const unidentifiedPending = nonces.some(
    (nonce) => !resolvedNonces.has(nonce) && !pairs[nonce],
  );
  const sharingDisabled =
    busy ||
    !storageReady ||
    unidentifiedPending ||
    sources.isFetching ||
    Boolean(sourceFailure) ||
    sources.isError;
  function pendingWorkspaces(sourceId: string): readonly string[] {
    return nonces.flatMap((nonce) =>
      !resolvedNonces.has(nonce) && pairs[nonce]?.sourceId === sourceId
        ? [pairs[nonce]!.workspaceId]
        : [],
    );
  }
  return (
    <section
      className="space-y-4"
      aria-label="Personal account workspace access"
    >
      <details onToggle={(event) => setBulk(event.currentTarget.open)}>
        <summary className="w-fit cursor-pointer text-sm text-slate-400">
          Share multiple connections
        </summary>
        {bulk ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ShareDialog
              scope={bootstrap.scope}
              api={api}
              sourceIds={selected.map((source) => source.sourceId).sort()}
              disabled={
                sharingDisabled ||
                unresolved ||
                !selected.length ||
                selectionStale
              }
              share={share}
            />
            <span className="text-sm text-slate-400">
              {selected.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setSelected([])}
            >
              Clear selection
            </Button>
          </div>
        ) : null}
      </details>
      {message ? (
        <p role="status" className="text-sm text-slate-300">
          {message}
        </p>
      ) : null}
      {unresolved && !busy ? (
        <p className="text-sm text-amber-200">
          Check the original request below before retrying unconfirmed workspace
          access.
        </p>
      ) : null}
      {selectionStale ? (
        <p role="alert" className="text-sm text-amber-200">
          A selected account changed or is unavailable. Clear the selection and
          choose again.
        </p>
      ) : null}
      {sourceFailure || sources.isError ? (
        <p role="status">{errorText(sourceFailure?.status ?? "unavailable")}</p>
      ) : null}
      <div>
        <div
          className={`hidden gap-3 border-b border-cyan-200/15 py-2 text-xs uppercase tracking-wider text-slate-400 lg:grid ${accountsGridColumns}`}
          aria-hidden="true"
        >
          <span>Account</span>
          <span>Available in</span>
          <span>Status</span>
          <span />
        </div>
        <div className="divide-y divide-cyan-200/10">
          {!inventory.length && !sourceFailure && !sources.isError ? (
            <p className="py-4 text-sm text-slate-400">
              No personal accounts on the loaded pages.
            </p>
          ) : null}
          {inventory.map((id) => {
            const source = sourcesById.get(id);
            const account = managementById.get(id);
            const accessSummary = summaryBySource.get(id);
            const label = account?.label ?? source!.label;
            const personalOnly = account?.connection?.personalOnly === true;
            const canAdd =
              !personalOnly &&
              source?.state === "active" &&
              source.profileId !== null &&
              !source.sourceOperationPending &&
              !lifecycleActivities.has(id);
            const status: AccountStatusInfo = sources.isError
              ? { kind: "unknown", text: "Details could not be refreshed" }
              : lifecycleActivities.get(id) === "delete" ||
                  (account?.lifecycle?.status === "pending" &&
                    account.lifecycle.action === "delete")
                ? { kind: "removing", text: pendingStatusCopy.removing }
                : lifecycleActivities.has(id) || source?.sourceOperationPending
                  ? { kind: "confirming", text: pendingStatusCopy.confirming }
                  : account
                    ? accountStatusInfo(account)
                    : { kind: "unknown", text: pendingStatusCopy.unknown };
            return (
              <article
                key={id}
                aria-label={label}
                className={`grid min-w-0 items-center gap-3 py-4 ${accountsGridColumns}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    {bulk && source && !personalOnly ? (
                      <Checkbox
                        aria-label={`Select ${label}`}
                        checked={selected.some(
                          (value) => value.sourceId === id,
                        )}
                        disabled={sharingDisabled || !canAdd}
                        onChange={(event) =>
                          setSelected((prior) =>
                            event.target.checked
                              ? [
                                  ...prior,
                                  {
                                    sourceId: id,
                                    metadataRevision: source.metadataRevision,
                                  },
                                ]
                              : prior.filter((row) => row.sourceId !== id),
                          )
                        }
                      />
                    ) : null}
                    <AccountIdentity
                      label={label}
                      {...(account
                        ? {
                            profileLabel: account.profileLabel,
                            provider: account.provider,
                            authKind: account.authKind,
                            connection: account.connection,
                          }
                        : {})}
                    />
                  </div>
                  <AccountLimitsLine
                    scope={
                      limitsContext?.scope ??
                      accountLimitsScope(bootstrap.scope)
                    }
                    context={limitsContext?.context ?? bootstrap.scope}
                    connectionId={id}
                    client={client}
                    expectedDisplayToken={
                      limitsContext?.projections?.get(id)?.displayToken
                    }
                    expectedStatus={limitsContext?.projections?.get(id)?.status}
                    expectedFetchedAt={
                      limitsContext?.projections?.get(id)?.fetchedAt
                    }
                    blocked={
                      (limitsContext?.replacingBootstrap &&
                        !limitsContext.allowed?.has(id)) ||
                      limitsContext?.removed?.has(id) ||
                      limitsContext?.denied ||
                      lifecycleActivities.has(id) ||
                      source?.sourceOperationPending ||
                      account?.state === "tombstoned"
                    }
                  />
                  {source?.state === "disabled" ||
                  account?.state === "tombstoned" ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Retired accounts cannot reconnect. Connect a new account
                      instead. Credential cleanup is not confirmed.
                    </p>
                  ) : null}
                  {!source ? (
                    <p className="mt-2 text-sm text-slate-400">
                      Workspace access unavailable on the loaded source pages.
                    </p>
                  ) : null}
                </div>
                {personalOnly ? (
                  <span className="text-xs text-slate-400">Personal use</span>
                ) : (
                  <AccessSummaryChips summary={accessSummary} />
                )}
                <p className="text-sm text-slate-300">
                  <AccountStatusLine {...status} />
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {source && !personalOnly ? (
                    <WorkspaceAccess
                      scope={bootstrap.scope}
                      source={source}
                      api={api}
                      disabled={sharingDisabled}
                      pendingWorkspaces={pendingWorkspaces(source.sourceId)}
                      canAdd={Boolean(canAdd)}
                      share={(targets) =>
                        share(targets, [
                          {
                            sourceId: source.sourceId,
                            metadataRevision: source.metadataRevision,
                          },
                        ])
                      }
                      revoke={revoke}
                      currentWorkspace={currentWorkspaceId ?? currentWorkspace}
                      addToWorkspace={Boolean(
                        canAdd &&
                        accessSummary &&
                        !accessSummary.hasRestrictedAccess &&
                        accessSummary.organizationCount ===
                          accessSummary.organizations.length &&
                        accessSummary.personalWorkspaceId !==
                          (currentWorkspaceId ?? currentWorkspace) &&
                        !accessSummary.organizations.some(
                          (organization) =>
                            organization.workspaceId ===
                            (currentWorkspaceId ?? currentWorkspace),
                        ),
                      )}
                      message={sourceMessages[source.sourceId]}
                    />
                  ) : null}
                  {account ? (
                    <AccountActionsMenu label={label}>
                      {managementActions?.(account)}
                      {currentWorkspaceId ? (
                        <AccountLifecycleControls
                          account={account}
                          context={bootstrap.scope}
                          workspaceId={currentWorkspaceId}
                          client={client}
                          accessSummary={summaryBySource.get(id)}
                        />
                      ) : null}
                    </AccountActionsMenu>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {sources.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          disabled={sources.isFetchingNextPage}
          onClick={() => void sources.fetchNextPage()}
        >
          Load more personal accounts
        </Button>
      ) : null}
      {!managementActions ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || sources.isFetching}
          onClick={() => void refresh()}
        >
          Refresh personal accounts
        </Button>
      ) : null}
      {nonces.length ? (
        <div className="space-y-2 border-t border-cyan-200/10 pt-4">
          <h4 className="font-medium text-cyan-50">Recent sharing requests</h4>
          <p className="text-sm text-slate-400">
            Check each request separately. A pending or unavailable result does
            not confirm remote completion.
          </p>
          {nonces.map((nonce) => (
            <OperationStatus
              key={nonce}
              scope={bootstrap.scope}
              nonce={nonce}
              api={api}
              sources={sourceFailure || sources.isError ? [] : sourceRows}
              pair={
                pairs[nonce]?.viewKey === currentWorkspace
                  ? pairs[nonce]
                  : undefined
              }
              refresh={refreshFromRead}
              markResolved={markResolved}
              dismiss={() => {
                try {
                  const next = nonces.filter((value) => value !== nonce);
                  sessionStorage.setItem(storageKey, JSON.stringify(next));
                  setNonces(next);
                } catch {
                  setMessage("Could not hide this result.");
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AccessSummaryChips({
  summary,
}: {
  summary: PersonalAccessSummary | undefined;
}) {
  const organizations = summary?.organizations ?? [];
  return (
    <div
      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-300"
      aria-label="Available in"
    >
      <AccessChip
        {...(summary?.personalWorkspaceId
          ? {
              href: dashboardSectionHref("setup", summary.personalWorkspaceId),
            }
          : {})}
      >
        {accountsCopy.personal}
      </AccessChip>
      {organizations.map((organization) => (
        <AccessChip
          key={organization.workspaceId}
          href={dashboardSectionHref("setup", organization.workspaceId)}
          title={organization.label}
          avatarUrl={organization.avatarUrl}
        >
          {organization.label}
        </AccessChip>
      ))}
      {summary && summary.hasRestrictedAccess ? (
        <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-amber-100">
          {accountsCopy.privacy}
        </span>
      ) : null}
    </div>
  );
}

function AccessChip({
  href,
  title,
  avatarUrl,
  children,
}: {
  href?: string | undefined;
  title?: string | undefined;
  avatarUrl?: string | null | undefined;
  children: ReactNode;
}) {
  // Truncation lives on the inner text, never on the chip: an overflow-hidden
  // parent would clip the corner avatar pinned outside the chip box.
  const className =
    "relative inline-flex max-w-48 items-center rounded-full border border-cyan-200/15 bg-white/[0.035] px-2 py-1";
  return href ? (
    <a
      href={href}
      title={title}
      className={`${className} text-cyan-100 transition-colors hover:border-cyan-200/40 hover:text-cyan-50`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChipAvatar avatarUrl={avatarUrl} label={title ?? ""} />
    </a>
  ) : (
    <span className={className} title={title}>
      <span className="min-w-0 truncate">{children}</span>
      <ChipAvatar avatarUrl={avatarUrl} label={title ?? ""} />
    </span>
  );
}

// Mini org picture pinned to the chip corner, flush against it; without a
// picture the org initial is drawn instead so the corner is never empty.
function ChipAvatar({
  avatarUrl,
  label,
}: {
  avatarUrl?: string | null | undefined;
  label: string;
}): React.ReactElement | null {
  if (!avatarUrl && !label) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center overflow-hidden rounded-full bg-cyan-200/25 text-[0.6rem] font-bold leading-none text-cyan-50 ring-2 ring-[var(--rr-page-bg)]"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        label.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function ShareDialog({
  scope,
  api,
  sourceIds,
  disabled,
  share,
}: {
  scope: string;
  api: PersonalAccountsApi;
  sourceIds: readonly string[];
  disabled: boolean;
  share(
    targets: readonly {
      workspaceId: string;
      predecessors?: readonly {
        sourceId: string;
        bindingId: string;
        revision: number;
      }[];
    }[],
  ): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const organizations = useInfiniteQuery({
    queryKey: keys.organizations(scope, sourceIds),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listEligibleOrganizations({
        sourceIds,
        ...(pageParam ? { afterWorkspaceId: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    enabled: open && sourceIds.length > 0,
    staleTime: 15000,
    retry: false,
  });
  const rows =
    organizations.data?.pages.flatMap((page) =>
      page.status === "ok" ? page.value.organizations : [],
    ) ?? [];
  const failure = organizations.data?.pages.find(
    (page) => page.status !== "ok",
  );
  const targets = rows.filter((row) => selected.includes(row.workspaceId));
  const count = sourceIds.length * targets.length;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!submitting) {
          setOpen(value);
          setSelected([]);
        }
      }}
    >
      <Dialog.Trigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
      >
        Share selected accounts
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Share with organizations</Dialog.Title>
          <Dialog.Description>
            Select organizations where you are an owner or admin. Your account
            name will be visible there. Each account and organization is
            processed separately; check each result below.
          </Dialog.Description>
          <div className="my-4 max-h-72 space-y-3 overflow-y-auto">
            {organizations.isPending ? (
              <p role="status">Loading eligible organizations...</p>
            ) : null}
            {failure || organizations.isError ? (
              <p role="status">{errorText(failure?.status ?? "unavailable")}</p>
            ) : null}
            {!organizations.isPending && !failure && !rows.length ? (
              <p>
                No eligible organizations. You must be an owner or admin to
                share your account.
              </p>
            ) : null}
            {rows.map((row) => (
              <label key={row.workspaceId} className="flex items-center gap-3">
                <Checkbox
                  checked={selected.includes(row.workspaceId)}
                  disabled={submitting}
                  onChange={(event) =>
                    setSelected((prior) =>
                      event.target.checked
                        ? [...prior, row.workspaceId]
                        : prior.filter((id) => id !== row.workspaceId),
                    )
                  }
                />
                {row.label}
              </label>
            ))}
            {organizations.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={organizations.isFetchingNextPage || submitting}
                onClick={() => void organizations.fetchNextPage()}
              >
                Load more organizations
              </Button>
            ) : null}
          </div>
          {count > 100 ? (
            <p role="alert">
              Choose at most 100 account and organization pairs per request.
            </p>
          ) : null}
          <Dialog.Footer>
            <Dialog.Close
              render={<Button variant="ghost" disabled={submitting} />}
            >
              Cancel
            </Dialog.Close>
            <Button
              disabled={
                !count ||
                count > 100 ||
                disabled ||
                submitting ||
                Boolean(failure) ||
                organizations.isError ||
                organizations.isFetching
              }
              onClick={async () => {
                setSubmitting(true);
                try {
                  await share(targets);
                  setOpen(false);
                  setSelected([]);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              Share {count || "selected"}{" "}
              {count === 1 ? "connection" : "connections"}
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkspaceAccess({
  scope,
  source,
  api,
  disabled,
  pendingWorkspaces,
  canAdd,
  share,
  revoke,
  currentWorkspace,
  addToWorkspace,
  message,
}: {
  scope: string;
  source: PersonalSource;
  api: PersonalAccountsApi;
  disabled: boolean;
  pendingWorkspaces: readonly string[];
  canAdd: boolean;
  share(
    targets: readonly {
      workspaceId: string;
      predecessors?: readonly {
        sourceId: string;
        bindingId: string;
        revision: number;
      }[];
    }[],
  ): Promise<void>;
  revoke(source: PersonalSource, grant: OwnAccountGrant): Promise<void>;
  currentWorkspace: string;
  addToWorkspace: boolean;
  message: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const grants = useInfiniteQuery({
    queryKey: keys.grants(scope, source.sourceId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listOwnGrants({
        sourceId: source.sourceId,
        ...(pageParam ? { afterBindingId: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    enabled: open,
    staleTime: 15000,
    retry: false,
  });
  const organizations = useInfiniteQuery({
    queryKey: keys.organizations(scope, [source.sourceId]),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listEligibleOrganizations({
        sourceIds: [source.sourceId],
        ...(pageParam ? { afterWorkspaceId: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    enabled: open,
    staleTime: 15000,
    retry: false,
  });
  const rows = [
    ...new Map(
      (
        grants.data?.pages.flatMap((page) =>
          page.status === "ok" ? page.value.grants : [],
        ) ?? []
      ).map((grant) => [grant.bindingId, grant]),
    ).values(),
  ];
  const targets =
    organizations.data?.pages.flatMap((page) =>
      page.status === "ok" ? page.value.organizations : [],
    ) ?? [];
  const grantFailure =
    grants.isError || grants.data?.pages.some((page) => page.status !== "ok");
  const targetFailure =
    organizations.isError ||
    organizations.data?.pages.some((page) => page.status !== "ok");
  // Existing grant labels are independently authorized. Never fill a hidden
  // grant name from eligible-organization cache, including former memberships.
  const newTargets = targets.filter(
    (target) =>
      !rows.some(
        (grant) =>
          grant.targetWorkspaceId === target.workspaceId &&
          (grant.organizationLabel === null ||
            grant.state === "active" ||
            grant.remoteFenceDelivery === "remote_pending"),
      ),
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          if (grants.data) void grants.refetch();
          if (organizations.data) void organizations.refetch();
        }
      }}
    >
      <Dialog.Trigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
        aria-label={`${addToWorkspace ? "Add to workspace" : accountsCopy.access}: ${source.label}`}
      >
        {addToWorkspace ? "Add to workspace" : accountsCopy.access}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup initialFocus={closeRef} className="w-[min(92vw,44rem)]">
          <Dialog.Title>
            {accountsCopy.access} · {source.label}
          </Dialog.Title>
          <Dialog.Description>
            Personal access stays permanent. Organization access only covers
            reviews; it never transfers ownership, credentials, or connection
            control.
          </Dialog.Description>
          {message ? (
            <p role="status" className="mt-3 text-sm text-cyan-100">
              {message}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between border-b border-cyan-200/10 py-3">
              <span>Personal workspace</span>
              <Badge tone="neutral">Your account</Badge>
            </div>
            <h4 className="font-medium">Current access</h4>
            {grants.isPending ? <p role="status">Loading access...</p> : null}
            {grantFailure ? (
              <p role="status">
                Access could not be refreshed. Existing results may be
                incomplete.
              </p>
            ) : null}
            {!grants.isPending && !grantFailure && !rows.length ? (
              <p className="text-sm text-slate-400">
                No organization access on the loaded pages.
              </p>
            ) : null}
            {[...(grantFailure ? [] : rows)]
              .filter(
                (grant) =>
                  grant.state !== "revoked" ||
                  grant.remoteFenceDelivery === "remote_pending",
              )
              .sort(
                (a, b) =>
                  Number(
                    Boolean(b.organizationLabel) &&
                      b.targetWorkspaceId === currentWorkspace,
                  ) -
                  Number(
                    Boolean(a.organizationLabel) &&
                      a.targetWorkspaceId === currentWorkspace,
                  ),
              )
              .map((grant) => (
                <div
                  key={grant.bindingId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-words">
                      {grant.organizationLabel ?? "Workspace unavailable"}
                      {grant.organizationLabel &&
                      grant.targetWorkspaceId === currentWorkspace
                        ? " · current workspace"
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {grant.remoteFenceDelivery === "remote_pending"
                        ? grant.state === "revoked"
                          ? "Access revoked locally; Gateway confirmation is pending"
                          : "Gateway confirmation is pending; availability is not confirmed"
                        : grant.state === "active"
                          ? "Access kept in this workspace"
                          : "Previous access revoked"}
                    </p>
                    {grant.state === "active" &&
                    grant.remoteFenceDelivery !== "remote_pending" &&
                    grant.organizationLabel ? (
                      <a
                        className="text-sm text-cyan-200 underline"
                        href={dashboardSectionHref(
                          "policy",
                          grant.targetWorkspaceId,
                        )}
                      >
                        Choose in Models
                      </a>
                    ) : null}
                  </div>
                  {grant.canRevoke ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        disabled ||
                        pendingWorkspaces.includes(grant.targetWorkspaceId) ||
                        grants.isFetching ||
                        Boolean(grantFailure)
                      }
                      onClick={() => void revoke(source, grant)}
                    >
                      Remove access
                    </Button>
                  ) : null}
                </div>
              ))}
            {grants.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={grants.isFetching}
                onClick={() => void grants.fetchNextPage()}
              >
                Load more access
              </Button>
            ) : null}
            <details className="border-t border-cyan-200/10 pt-3">
              <summary className="cursor-pointer text-sm text-slate-300">
                Revoked access history
              </summary>
              <p className="mt-2 text-xs text-slate-400">
                If the organization name is unavailable, the entry shows as
                &quot;Workspace unavailable&quot;. The source owner can revoke
                it.
              </p>
              <div className="mt-2">
                {(grantFailure ? [] : rows)
                  .filter(
                    (grant) =>
                      grant.state === "revoked" &&
                      grant.remoteFenceDelivery !== "remote_pending",
                  )
                  .map((grant) => (
                    <div
                      key={grant.bindingId}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-200/10 py-2 text-sm"
                    >
                      <span>
                        {grant.organizationLabel ?? "Workspace unavailable"}
                        <span className="block text-xs text-slate-400">
                          Previous access revoked
                        </span>
                      </span>
                      {grant.canRevoke ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={disabled || grants.isFetching}
                          onClick={() => void revoke(source, grant)}
                        >
                          Revoke exact entry
                        </Button>
                      ) : null}
                    </div>
                  ))}
              </div>
            </details>
            <h4 className="pt-2 font-medium">Add organization</h4>
            {organizations.isPending ? (
              <p role="status">Loading eligible organizations...</p>
            ) : null}
            {targetFailure ? (
              <p role="status">
                Eligible organizations could not be refreshed.
              </p>
            ) : null}
            {!organizations.isPending &&
            !targetFailure &&
            !newTargets.length ? (
              <p className="text-sm text-slate-400">
                No other eligible organizations.
              </p>
            ) : null}
            {[...(targetFailure ? [] : newTargets)]
              .sort(
                (a, b) =>
                  Number(b.workspaceId === currentWorkspace) -
                  Number(a.workspaceId === currentWorkspace),
              )
              .map((target) => (
                <div
                  key={target.workspaceId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0 break-words">
                    {target.label}
                    {target.workspaceId === currentWorkspace
                      ? " · current workspace"
                      : ""}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Add access to ${target.label}`}
                    disabled={
                      disabled ||
                      pendingWorkspaces.includes(target.workspaceId) ||
                      !canAdd ||
                      organizations.isFetching ||
                      grants.isPending ||
                      grants.isFetching ||
                      Boolean(grantFailure) ||
                      Boolean(targetFailure) ||
                      grants.hasNextPage
                    }
                    onClick={() => void share([target])}
                  >
                    Add
                  </Button>
                </div>
              ))}
            {organizations.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={organizations.isFetching}
                onClick={() => void organizations.fetchNextPage()}
              >
                Load more organizations
              </Button>
            ) : null}
            {!canAdd ? (
              <p className="text-sm text-slate-400">
                This connection cannot be shared right now. Existing allowed
                access can still be revoked.
              </p>
            ) : null}
            <p className="text-xs text-slate-400">
              Load all access pages before adding. Personal workspace is
              separate from organizations. Request results stay below after the
              dialog closes.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Dialog.Close render={<Button ref={closeRef} variant="outline" />}>
              Close
            </Dialog.Close>
            <Button
              variant="ghost"
              size="sm"
              disabled={grants.isFetching || organizations.isFetching}
              onClick={() =>
                void Promise.all([grants.refetch(), organizations.refetch()])
              }
            >
              Refresh access
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OperationStatus({
  scope,
  nonce,
  api,
  sources,
  pair,
  dismiss,
  refresh,
  markResolved,
}: {
  scope: string;
  nonce: string;
  api: PersonalAccountsApi;
  sources: readonly PersonalSource[];
  pair: PairContext | undefined;
  dismiss(): void;
  refresh(nonce: string): Promise<void>;
  markResolved(nonce: string, resolved: boolean): void;
}) {
  const operation = useQuery({
    queryKey: keys.operation(scope, nonce),
    queryFn: () => api.readOperation(nonce),
    staleTime: 3000,
    retry: false,
  });
  const result = operation.data;
  const useIntentPair =
    pair?.kind === "attach" &&
    result?.status !== "denied" &&
    (result?.status !== "ok" || !result.value.operation.bindingId);
  const source = sources.find(
    (row) =>
      result?.status !== "denied" &&
      row.sourceId ===
        (result?.status === "ok"
          ? (result.value.operation.sourceId ?? pair?.sourceId)
          : pair?.sourceId),
  );
  const pendingOrganizations = useInfiniteQuery({
    queryKey: keys.organizations(scope, source ? [source.sourceId] : []),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listEligibleOrganizations({
        sourceIds: [source!.sourceId],
        ...(pageParam ? { afterWorkspaceId: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    enabled: Boolean(source && pair && useIntentPair),
    staleTime: 15000,
    retry: false,
  });
  const pendingOrganization =
    !useIntentPair ||
    pendingOrganizations.isError ||
    pendingOrganizations.isFetching ||
    pendingOrganizations.data?.pages.some((page) => page.status !== "ok")
      ? undefined
      : pendingOrganizations.data?.pages
          .flatMap((page) =>
            page.status === "ok" ? page.value.organizations : [],
          )
          .find((row) => row.workspaceId === pair?.workspaceId);
  // Reuse authorized grant pages; do not persist display names or guess an
  // organization from an opaque binding. Off-page or hidden names stay hidden.
  const grants = useInfiniteQuery({
    queryKey: keys.grants(scope, source?.sourceId ?? ""),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listOwnGrants({
        sourceId: source!.sourceId,
        ...(pageParam ? { afterBindingId: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    enabled: Boolean(
      source &&
      ((result?.status === "ok" && result.value.operation.bindingId) ||
        pair?.kind === "revoke"),
    ),
    staleTime: 15000,
    retry: false,
  });
  const grantsUnavailable =
    grants.isError ||
    grants.isFetching ||
    grants.data?.pages.some((page) => page.status !== "ok");
  const grant = grantsUnavailable
    ? undefined
    : grants.data?.pages
        .flatMap((page) => (page.status === "ok" ? page.value.grants : []))
        .find(
          (row) =>
            row.sourceId === source?.sourceId &&
            row.bindingId ===
              (result?.status === "ok"
                ? result.value.operation.bindingId
                : pair?.kind === "revoke"
                  ? pair.bindingId
                  : undefined),
        );
  const resolved = result?.status === "ok" && isTerminalReceipt(result.value);
  const terminalTransitionRefreshed = useRef(false);
  useEffect(() => {
    // A denied/unavailable read is not evidence about the original mutation.
    // Once a terminal receipt was observed, later failed reads cannot undo it.
    if (!resolved) return;
    markResolved(nonce, true);
    // Focus and manual status reads may return the same immutable terminal
    // receipt. Notify related caches only once during this nonce's lifecycle.
    if (!terminalTransitionRefreshed.current) {
      terminalTransitionRefreshed.current = true;
      void refresh(nonce);
    }
  }, [nonce, resolved, markResolved, refresh]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p role="status" className="text-sm text-slate-300">
        {source ? (
          <span className="block font-medium">
            {source.label} ·{" "}
            {grant?.organizationLabel ??
              pendingOrganization?.label ??
              "Workspace unavailable"}
          </span>
        ) : null}
        Request {nonce.slice(0, 8)}:{" "}
        {result?.status === "ok"
          ? receiptText(result.value)
          : result
            ? errorText(result.status)
            : "Checking status..."}
      </p>
      <div className="flex flex-wrap gap-2">
        {result?.status === "ok" &&
        result.value.operation.available &&
        grant?.organizationLabel ? (
          <a
            className="text-sm text-cyan-200 underline"
            href={dashboardSectionHref("policy", grant.targetWorkspaceId)}
          >
            Choose for reviews
          </a>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={
            operation.isFetching ||
            grants.isFetching ||
            pendingOrganizations.isFetching
          }
          onClick={() => {
            void operation.refetch();
            if (
              source &&
              ((result?.status === "ok" && result.value.operation.bindingId) ||
                pair?.kind === "revoke")
            )
              void grants.refetch();
            else if (source && pair && result?.status !== "denied")
              void pendingOrganizations.refetch();
          }}
        >
          Check status
        </Button>
        {resolved ? (
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Hide result
          </Button>
        ) : null}
      </div>
    </div>
  );
}
