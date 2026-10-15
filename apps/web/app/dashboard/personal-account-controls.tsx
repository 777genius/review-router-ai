"use client";

import { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Badge, Button, Dialog } from "@reviewrouter/ui";
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
const noncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
}: {
  bootstrap?: PersonalAccountsBootstrap;
  api?: PersonalAccountsApi;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  if (!bootstrap?.enabled || !api) return null;
  return (
    <QueryClientProvider client={client}>
      <PersonalControls key={bootstrap.scope} bootstrap={bootstrap} api={api} />
    </QueryClientProvider>
  );
}

function PersonalControls({
  bootstrap,
  api,
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<
    readonly { sourceId: string; metadataRevision: number }[]
  >([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [nonces, setNonces] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
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
      setNonces([...new Set(saved)]);
      setStorageReady(true);
    } catch {
      setMessage(
        "Enable session storage to preserve operation status before sharing or revoking an account.",
      );
    }
  }, [storageKey]);
  function reserveNonce() {
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
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setNonces(next);
    return nonce;
  }
  async function refresh(sourceIds: readonly string[] = []) {
    await Promise.all([
      client.invalidateQueries({
        queryKey: keys.sources(bootstrap.scope),
        exact: true,
      }),
      ...sourceIds.map((sourceId) =>
        client.invalidateQueries({
          queryKey: keys.grants(bootstrap.scope, sourceId),
          exact: true,
        }),
      ),
    ]);
  }
  async function run(
    call: (nonce: string) => ReturnType<PersonalAccountsApi["attach"]>,
  ) {
    let nonce: string;
    try {
      nonce = reserveNonce();
    } catch {
      setMessage(
        "Could not preserve operation status. Nothing was submitted. Hide completed results if the list is full.",
      );
      return;
    }
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
    setMessage(
      result.status === "ok"
        ? receiptText(result.value)
        : errorText(result.status),
    );
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
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // A finite set of independent operations, each with its own saved nonce.
      // Uncertain responses are read back, never resubmitted automatically.
      for (const source of selected)
        for (const target of targets) {
          const predecessor = target.predecessors?.find(
            (row) => row.sourceId === source.sourceId,
          );
          await run((nonce) =>
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
          );
        }
      await refresh(selected.map((source) => source.sourceId));
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
      await run((nonce) =>
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
      );
      await refresh([source.sourceId]);
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
  const focusedSource = sourceRows.find(
    (source) => source.sourceId === focused,
  );
  return (
    <section
      className="space-y-4 border-b border-cyan-200/10 pb-6"
      aria-labelledby="personal-accounts-title"
    >
      <div>
        <h3
          id="personal-accounts-title"
          className="text-lg font-semibold text-cyan-50"
        >
          My personal accounts
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Choose your accounts to share with organizations you administer. Each
          organization uses the same connection, name, authentication and
          account capacity. Sharing does not add capacity.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Organization accounts remain separate. Removing one organization's
          access preserves your personal use and other organizations' access.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ShareDialog
          scope={bootstrap.scope}
          api={api}
          sourceIds={selected.map((source) => source.sourceId).sort()}
          disabled={
            busy ||
            !storageReady ||
            !selected.length ||
            selectionStale ||
            sources.isFetching
          }
          share={share}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || sources.isFetching}
          onClick={() => void refresh(focused ? [focused] : [])}
        >
          Refresh personal accounts
        </Button>
        <span className="text-sm text-slate-400">
          {selected.length} selected
        </span>
        {selected.length ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setSelected([])}
          >
            Clear selection
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-sm text-slate-300">
          {message}
        </p>
      ) : null}
      {selectionStale ? (
        <p role="alert" className="text-sm text-amber-200">
          A selected account changed or is unavailable. Clear the selection and
          choose again.
        </p>
      ) : null}
      {sourceFailure ? (
        <p role="status">{errorText(sourceFailure.status)}</p>
      ) : null}
      <div className="divide-y divide-cyan-200/10">
        {!sourceRows.length && !sourceFailure ? (
          <p className="py-4 text-sm text-slate-400">
            No personal accounts connected yet.
          </p>
        ) : null}
        {sourceRows.map((source) => (
          <div
            key={source.sourceId}
            className="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 accent-cyan-300"
                aria-label={`Select ${source.label}`}
                checked={selected.some(
                  (value) => value.sourceId === source.sourceId,
                )}
                disabled={
                  busy ||
                  source.state !== "active" ||
                  source.profileId === null ||
                  source.sourceOperationPending
                }
                onChange={(event) =>
                  setSelected((prior) =>
                    event.target.checked
                      ? [
                          ...prior,
                          {
                            sourceId: source.sourceId,
                            metadataRevision: source.metadataRevision,
                          },
                        ]
                      : prior.filter((row) => row.sourceId !== source.sourceId),
                  )
                }
              />
              <span>
                <span className="block font-medium text-cyan-50">
                  {source.label}
                </span>
                <span className="mt-1 block text-sm text-slate-400">
                  {source.profileId ??
                    "Provider profile unavailable; sharing disabled"}
                </span>
                <span className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="neutral">Personal account</Badge>
                  <Badge tone="neutral">
                    {source.sourceOperationPending
                      ? "Connection update pending"
                      : source.state}
                  </Badge>
                </span>
              </span>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFocused(source.sourceId)}
            >
              Manage sharing for {source.label}
            </Button>
          </div>
        ))}
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
      {focusedSource ? (
        <OwnGrants
          scope={bootstrap.scope}
          source={focusedSource}
          api={api}
          disabled={busy || !storageReady}
          revoke={revoke}
        />
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
            Select organizations where you are an owner or admin. Your canonical
            account name will be visible there. Each account and organization is
            processed separately.
          </Dialog.Description>
          <div className="my-4 max-h-72 space-y-3 overflow-y-auto">
            {organizations.isPending ? (
              <p role="status">Loading eligible organizations...</p>
            ) : null}
            {failure ? <p role="status">{errorText(failure.status)}</p> : null}
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
                Boolean(failure)
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

function OwnGrants({
  scope,
  source,
  api,
  disabled,
  revoke,
}: {
  scope: string;
  source: PersonalSource;
  api: PersonalAccountsApi;
  disabled: boolean;
  revoke(source: PersonalSource, grant: OwnAccountGrant): Promise<void>;
}) {
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
    staleTime: 15000,
    retry: false,
  });
  const rows =
    grants.data?.pages.flatMap((page) =>
      page.status === "ok" ? page.value.grants : [],
    ) ?? [];
  const failure = grants.data?.pages.find((page) => page.status !== "ok");
  return (
    <div className="space-y-3 border-t border-cyan-200/10 pt-4">
      <h4 className="font-medium text-cyan-50">
        Organization access to {source.label}
      </h4>
      <p className="text-sm text-slate-400">
        You can revoke your own shared connection even after leaving an
        organization. Its name is hidden when you no longer have access.
        Existing saved settings keep the revoked connection unavailable until an
        explicit new selection.
      </p>
      {grants.isPending ? <p role="status">Loading access...</p> : null}
      {failure ? <p role="status">{errorText(failure.status)}</p> : null}
      {!grants.isPending && !failure && !rows.length ? (
        <p className="text-sm text-slate-400">
          No organization access on this page.
        </p>
      ) : null}
      {rows.map((grant) => (
        <div
          key={grant.bindingId}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 py-3"
        >
          <div>
            <p>{grant.organizationLabel ?? "Organization unavailable"}</p>
            <p className="mt-1 text-sm text-slate-400">
              {grant.state === "active"
                ? "Shared personal account"
                : grant.remoteFenceDelivery === "remote_pending"
                  ? "Revoked locally; gateway confirmation pending"
                  : "Access revoked"}
            </p>
          </div>
          {grant.canRevoke ? (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || grants.isFetching}
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
          disabled={grants.isFetchingNextPage}
          onClick={() => void grants.fetchNextPage()}
        >
          Load more access
        </Button>
      ) : null}
    </div>
  );
}

function OperationStatus({
  scope,
  nonce,
  api,
  dismiss,
}: {
  scope: string;
  nonce: string;
  api: PersonalAccountsApi;
  dismiss(): void;
}) {
  const operation = useQuery({
    queryKey: keys.operation(scope, nonce),
    queryFn: () => api.readOperation(nonce),
    staleTime: 3000,
    retry: false,
  });
  const result = operation.data;
  const resolved =
    result?.status === "ok" &&
    (result.value.remoteFenceDelivery === "remote_applied" ||
      result.value.operation.phase === "rejected" ||
      result.value.operation.available);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p className="text-sm text-slate-300">
        Request {nonce.slice(0, 8)}:{" "}
        {result?.status === "ok"
          ? receiptText(result.value)
          : result
            ? errorText(result.status)
            : "Checking status..."}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={operation.isFetching}
          onClick={() => void operation.refetch()}
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
