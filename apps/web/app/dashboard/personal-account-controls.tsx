"use client";

import {
  useCallback,
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
import { Badge, Button, Dialog } from "@reviewrouter/ui";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import { dashboardSectionHref } from "./dashboard-section";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import type {
  OwnAccountGrant,
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
  PersonalAccountsResult,
  PersonalAttachRequest,
  PersonalMutationReceipt,
  PersonalRevokeRequest,
  PersonalSource,
} from "../../src/features/account-gateway/personal-accounts";

const keys = {
  sources: (scope: string) => ["personal-accounts", scope, "sources"] as const,
  grants: (scope: string, sourceId: string) =>
    ["personal-accounts", scope, "grants", sourceId] as const,
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
          ["sources", "grants", "organizations"].includes(
            String(query.queryKey[2]),
          )) ||
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
      api.listSources({
        ...(pageParam ? { afterSourceId: pageParam } : {}),
        limit: 25,
      }),
    initialData: { pages: [bootstrap.page], pageParams: [null] },
    getNextPageParam: (page) =>
      page.status === "ok" ? page.value.nextCursor : null,
    staleTime: 15000,
    retry: false,
  });
  const sourceRows = sources.data.pages.flatMap((page) =>
    page.status === "ok" ? page.value.sources : [],
  );
  const sourceFailure = sources.data.pages.find((page) => page.status !== "ok");
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
  const refreshFromRead = useCallback(async () => {
    if (!busyRef.current) await refresh();
  }, [refresh]);
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
    busyRef.current = true;
    setBusy(true);
    try {
      // A finite set of independent operations, each with its own saved nonce.
      // Uncertain responses are read back, never resubmitted automatically.
      for (const source of choices)
        for (const target of targets) {
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
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function revoke(source: PersonalSource, grant: OwnAccountGrant) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
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
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const selectionStale = selected.some(
    (selection) =>
      !sourceRows.some(
        (source) =>
          source.sourceId === selection.sourceId &&
          source.metadataRevision === selection.metadataRevision &&
          source.profileId !== null &&
          source.state === "active" &&
          !source.sourceOperationPending,
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
          Share several accounts
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
      <div className="divide-y divide-cyan-200/10">
        {!inventory.length && !sourceFailure && !sources.isError ? (
          <p className="py-4 text-sm text-slate-400">
            No personal accounts on the loaded pages.
          </p>
        ) : null}
        {inventory.map((id) => {
          const source = sourcesById.get(id);
          const account = managementById.get(id);
          const label = account?.label ?? source!.label;
          const canAdd =
            source?.state === "active" &&
            source.profileId !== null &&
            !source.sourceOperationPending;
          return (
            <article
              key={id}
              aria-label={label}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {bulk && source ? (
                    <input
                      type="checkbox"
                      className="accent-cyan-300"
                      aria-label={`Select ${label}`}
                      checked={selected.some((value) => value.sourceId === id)}
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
                  <p className="break-words font-medium text-cyan-50">
                    {label}
                  </p>
                </div>
                {account ? (
                  <p className="mt-1 text-sm text-slate-400">
                    {account.profileLabel}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">
                    Connection details unavailable
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="neutral">Personal account</Badge>
                  <Badge tone="neutral">
                    {source?.sourceOperationPending
                      ? "Connection update pending"
                      : (account?.state ?? source?.state)}
                  </Badge>
                </div>
                {source?.state === "disabled" ||
                account?.state === "tombstoned" ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Retired accounts cannot reconnect. Connect a new account to
                    use it again. Credential cleanup is unverified.
                  </p>
                ) : null}
                {!source ? (
                  <p className="mt-2 text-sm text-slate-400">
                    Workspace access unavailable on the loaded source pages.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {source ? (
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
                    message={sourceMessages[source.sourceId]}
                  />
                ) : null}
                {account && managementActions ? (
                  <details className="text-sm">
                    <summary
                      className="cursor-pointer rounded-lg px-3 py-2 text-cyan-200"
                      aria-label={`Account actions for ${label}`}
                    >
                      Account actions
                    </summary>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {managementActions(account)}
                    </div>
                  </details>
                ) : null}
              </div>
            </article>
          );
        })}
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
          <Dialog.Title className="text-lg font-semibold">
            Share with organizations
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-slate-400">
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
                <input
                  type="checkbox"
                  className="accent-cyan-300"
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
          <div className="flex justify-end gap-3">
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
          </div>
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
  useEffect(() => {
    if (open && grants.hasNextPage && !grants.isFetching && !grantFailure)
      void grants.fetchNextPage();
  }, [
    open,
    grants.hasNextPage,
    grants.isFetching,
    grantFailure,
    grants.fetchNextPage,
  ]);
  useEffect(() => {
    if (
      open &&
      organizations.hasNextPage &&
      !organizations.isFetching &&
      !targetFailure
    )
      void organizations.fetchNextPage();
  }, [
    open,
    organizations.hasNextPage,
    organizations.isFetching,
    targetFailure,
    organizations.fetchNextPage,
  ]);
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button variant="outline" size="sm" />}
        aria-label={`Workspace access for ${source.label}`}
      >
        Workspace access
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup
          initialFocus={closeRef}
          className="max-h-[85dvh] overflow-y-auto"
        >
          <Dialog.Title className="text-lg font-semibold">
            Workspace access · {source.label}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-slate-400">
            Add organizations where you are an owner or admin. Removing access
            affects only that organization. Choose the account in Models
            afterward to use it for reviews.
          </Dialog.Description>
          {message ? (
            <p role="status" className="mt-3 text-sm text-cyan-100">
              {message}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            <h4 className="font-medium">Current access and history</h4>
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
            {[...rows]
              .sort(
                (a, b) =>
                  Number(b.targetWorkspaceId === currentWorkspace) -
                  Number(a.targetWorkspaceId === currentWorkspace),
              )
              .map((grant) => (
                <div
                  key={grant.bindingId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-words">
                      {grant.organizationLabel ?? "Organization unavailable"}
                      {grant.organizationLabel &&
                      grant.targetWorkspaceId === currentWorkspace
                        ? " · current workspace"
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {grant.remoteFenceDelivery === "remote_pending"
                        ? grant.state === "revoked"
                          ? "Revoked locally; gateway confirmation pending"
                          : "Gateway confirmation pending; availability not confirmed"
                        : grant.state === "active"
                          ? "Available in this workspace"
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
                        Choose for reviews
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
                      Revoke access
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
            <h4 className="pt-2 font-medium">Add workspace access</h4>
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
                No additional eligible organizations on the loaded pages.
              </p>
            ) : null}
            {[...newTargets]
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
                    Add access
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
                This connection cannot be shared right now. Existing access can
                still be removed when authorized.
              </p>
            ) : null}
            <p className="text-xs text-slate-400">
              Load remaining access pages before adding an organization. More
              pages may contain other access. Your personal workspace is
              separate from organization sharing. Request results remain below
              Your accounts after closing this dialog.
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
              Refresh workspace access
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
  refresh(): Promise<void>;
  markResolved(nonce: string, resolved: boolean): void;
}) {
  const operation = useQuery({
    queryKey: keys.operation(scope, nonce),
    queryFn: async () => {
      const result = await api.readOperation(nonce);
      if (
        result.status === "ok" &&
        (result.value.remoteFenceDelivery === "remote_applied" ||
          result.value.operation.phase === "rejected" ||
          result.value.operation.available)
      )
        await refresh();
      return result;
    },
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
  const resolved =
    result?.status === "ok" &&
    (result.value.remoteFenceDelivery === "remote_applied" ||
      result.value.operation.phase === "rejected" ||
      result.value.operation.available);
  useEffect(() => {
    // A denied/unavailable read is not evidence about the original mutation.
    // Once a terminal receipt was observed, later failed reads cannot undo it.
    if (resolved) markResolved(nonce, true);
  }, [nonce, resolved, markResolved]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p role="status" className="text-sm text-slate-300">
        {source ? (
          <span className="block font-medium">
            {source.label} ·{" "}
            {grant?.organizationLabel ??
              pendingOrganization?.label ??
              "Organization unavailable"}
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
