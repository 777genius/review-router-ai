"use client";

import { useRef, useState } from "react";
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
} from "@tanstack/react-query";
import { Badge, Button, Dialog } from "@reviewrouter/ui";
import type {
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import { personalAccountOriginText } from "../../src/features/account-gateway/personal-accounts";
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
  api?: GatewayModelAccountsApi;
  canDetach: boolean;
  detach(request: DetachRequest): Promise<DetachResult>;
};

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
  api,
  canDetach,
  detach,
  client,
}: Props & { api: GatewayModelAccountsApi; client: QueryClient }) {
  const pageKey = ["account-options", scope] as const;
  const [selection, setSelection] = useState<{
    label: string;
    request: DetachRequest;
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
  const rows = fetched
    .flatMap((page) => (page.status === "ok" ? page.value.accounts : []))
    .filter(
      (row) => "origin" in row && row.origin === "personal" && row.binding,
    );
  const accounts = [
    ...new Map(rows.map((row) => [row.binding!.id, row])).values(),
  ];

  async function submit(request: DetachRequest) {
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
        result = await mutation.mutateAsync(original);
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
      // A delayed pre-detach fetch must not restore the retired binding to Models.
      await Promise.all([
        client.cancelQueries({ queryKey: pageKey, exact: true }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      if (result.status === "ok") {
        client.setQueryData<
          InfiniteData<AccountsResult<AccountsPage>, string | null>
        >(pageKey, (prior) =>
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
        client.invalidateQueries({ queryKey: detailKey, exact: true }),
      ]);
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
    <section aria-label="Personal accounts shared with this organization">
      <h3 className="font-medium text-cyan-50">
        Personal accounts available to this organization
      </h3>
      <p className="mt-1 text-sm text-slate-400">
        Their owners share the same account, name, sign-in and review capacity
        with this organization. Choose an account in Models to use it for
        reviews. Detaching removes only this organization's access; it does not
        retire the owner's account or affect other organizations.
      </p>
      <p className="mt-1 text-sm text-slate-400">
        The owner manages the account's name, sign-in and retirement in My
        personal accounts. Here you manage only this organization's access.
      </p>
      {pages.isPending ? <p role="status">Loading shared accounts...</p> : null}
      {failed ? (
        <p role="status">
          Shared accounts could not be refreshed. Try refreshing again.
        </p>
      ) : null}
      {!pages.isPending && !failed && !accounts.length ? (
        <p>
          {pages.hasNextPage
            ? "No shared personal accounts on the loaded pages."
            : "No shared personal accounts available."}
        </p>
      ) : null}
      {accounts.map((row) => (
        <article
          key={row.binding!.id}
          aria-label={row.label}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-200/10 py-3"
        >
          <div>
            <p>{row.label}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge tone="neutral">
                {personalAccountOriginText(row)}
                {row.isOwnedByViewer === true ? " · shared here" : ""}
              </Badge>
              <Badge tone="neutral">{row.state}</Badge>
            </div>
          </div>
          {canDetach && row.binding!.state === "active" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() =>
                setSelection({
                  label: row.label,
                  request: {
                    bindingId: row.binding!.id,
                    expectedBindingRevision: row.binding!.revision,
                  },
                })
              }
            >
              Detach from this organization
            </Button>
          ) : null}
        </article>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pages.isFetching || submitting}
          onClick={() => void pages.refetch()}
        >
          Refresh shared accounts
        </Button>
        {pages.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pages.isFetching || submitting}
            onClick={() => void pages.fetchNextPage()}
          >
            Load more shared accounts
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
          disabled={submitting}
          onClick={() => void submit(last.request)}
        >
          Check confirmation
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
            <Dialog.Title>Detach from this organization?</Dialog.Title>
            <Dialog.Description>
              {selection?.label} will stop being available here. The personal
              account and its use in other organizations are unaffected.
            </Dialog.Description>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => setSelection(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={!canDetach || submitting || !selection}
                onClick={() => {
                  if (selection) void submit(selection.request);
                }}
              >
                Confirm detachment
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
