"use client";

import { useAccountLifecycleActivities } from "./account-lifecycle-controls";

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
import { Badge, Button, Dialog, SelectField } from "@reviewrouter/ui";
import {
  AccountActionsMenu,
  AccountMenuItem,
  accountMenuItemClass,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import { Plus, RefreshCw } from "lucide-react";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import { dashboardSectionHref } from "./dashboard-section";
import { accountsCopy } from "./accounts-copy";
import { personalAccountOriginText } from "../../src/features/account-gateway/personal-accounts";
import {
  canonicalMimoBaseURL,
  mimoTokenPlanEndpoints,
  suggestedAccountLabel,
} from "../../src/features/account-gateway/connection-options";
import type {
  AccountIntent,
  AccountOAuthIntent,
  AccountOAuthReconnectIntent,
  AccountOperationView,
  AccountProfileView,
  AccountView,
  AccountsBootstrap,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  bindGatewayAccount,
  beginGatewayOAuth,
  completeGatewayOAuth,
  detachGatewayAccount,
  listGatewayAccounts,
  mutateGatewayAccount,
  readGatewayOperation,
  submitGatewayApiKey,
} from "./account-gateway-account-actions";

export type AccountGatewayManagementApi = Pick<
  typeof defaultManagementApi,
  | "listGatewayAccounts"
  | "mutateGatewayAccount"
  | "submitGatewayApiKey"
  | "readGatewayOperation"
  | "beginGatewayOAuth"
  | "completeGatewayOAuth"
>;
const defaultManagementApi = {
  listGatewayAccounts,
  mutateGatewayAccount,
  submitGatewayApiKey,
  readGatewayOperation,
  beginGatewayOAuth,
  completeGatewayOAuth,
};
export type AccountRowsRenderer = (
  accounts: readonly AccountView[],
  actions: (account: AccountView) => ReactNode,
) => ReactNode;

type ManagementScope = "workspace" | "personal";

// Small safe keys: scoped stable user/workspace locator; no signature or secret.
const pageKey = (scope: string, cursor: string | null) =>
  ["gateway-accounts", scope, "page", cursor] as const;
const operationKey = (scope: string, nonce: string) =>
  ["gateway-accounts", scope, "operation", nonce] as const;
const noncePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function savedNonces(key: string): string[] {
  const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
  if (
    !Array.isArray(saved) ||
    saved.length > 8 ||
    !saved.every((n) => typeof n === "string" && noncePattern.test(n))
  )
    throw new Error();
  return [...new Set(saved as string[])];
}
type OAuthFormIntent =
  | Omit<AccountOAuthIntent, "nonce">
  | Omit<AccountOAuthReconnectIntent, "nonce">;
const inputClass =
  "min-h-11 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-cyan-50";
function statusText(
  status: AccountsResult<unknown>["status"],
  managementScope: ManagementScope = "workspace",
) {
  return status === "denied"
    ? managementScope === "personal"
      ? "Sign in as the owner of this personal account."
      : "You need workspace owner or admin access."
    : status === "conflict"
      ? "The account changed. Refresh Accounts before trying again."
      : status === "invalid"
        ? "Check the account fields."
        : "Account management is unavailable. Refresh or check the connection later.";
}
function operationStateText(
  state: AccountOperationView["state"] | "unresolved",
) {
  return state === "pending"
    ? "Waiting for completion"
    : state === "applied"
      ? "Completed"
      : state === "rejected"
        ? "Declined"
        : state === "unresolved"
          ? "Checking status"
          : "Status unavailable";
}
function validAuthorizationURL(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.host) &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function AccountGatewayControls({
  bootstrap,
  api = defaultManagementApi,
  managementScope = "workspace",
  queryClient,
  refreshRelated,
  renderAccounts,
  hideConnect = false,
  connectOnly = false,
  workspaceId,
}: {
  bootstrap: AccountsBootstrap;
  api?: AccountGatewayManagementApi;
  managementScope?: ManagementScope;
  queryClient?: QueryClient;
  refreshRelated?: () => Promise<void>;
  renderAccounts?: AccountRowsRenderer;
  hideConnect?: boolean;
  connectOnly?: boolean;
  workspaceId?: string;
}) {
  const optionsCache = useCurrentGatewayModelAccountsCache();
  const [fallback] = useState(() => new QueryClient());
  const client = queryClient ?? optionsCache?.client ?? fallback;
  if (managementScope === "personal" && api === defaultManagementApi)
    return <p role="status">Personal account management is unavailable.</p>;
  return (
    <QueryClientProvider client={client}>
      <Controls
        bootstrap={bootstrap}
        api={api}
        managementScope={managementScope}
        refreshRelated={refreshRelated}
        renderAccounts={renderAccounts}
        hideConnect={hideConnect}
        connectOnly={connectOnly}
        workspaceId={workspaceId}
      />
    </QueryClientProvider>
  );
}

function Controls({
  bootstrap,
  api,
  managementScope,
  refreshRelated,
  renderAccounts,
  hideConnect,
  connectOnly,
  workspaceId,
}: {
  bootstrap: AccountsBootstrap;
  api: AccountGatewayManagementApi;
  managementScope: ManagementScope;
  refreshRelated: (() => Promise<void>) | undefined;
  renderAccounts: AccountRowsRenderer | undefined;
  hideConnect: boolean;
  connectOnly: boolean;
  workspaceId: string | undefined;
}) {
  const { context } = bootstrap;
  const contextScope = context.split(".")[0] ?? "";
  const personal = managementScope === "personal";
  const scope = personal ? `personal:${contextScope}` : contextScope;
  const storageKey = `rr-c3-account-operations:${scope}`;
  const client = useQueryClient();
  const optionsCache = useCurrentGatewayModelAccountsCache();
  const [nonces, setNonces] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lifecycleActivities = useAccountLifecycleActivities(client);
  const [completionHandoff, setCompletionHandoff] = useState<string | null>(
    null,
  );
  const completionHandoffRef = useRef<string | null>(null);
  const submitting = useRef(false);
  const page = useInfiniteQuery({
    queryKey: pageKey(scope, null),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.listGatewayAccounts(context, pageParam),
    initialData: { pages: [bootstrap.page], pageParams: [null] },
    getNextPageParam: (result) =>
      result.status === "ok" ? result.value.nextCursor : null,
    enabled: Boolean(context),
    staleTime: 15000,
    retry: false,
  });
  useEffect(() => {
    try {
      setNonces(savedNonces(storageKey));
      setReady(true);
    } catch {
      setMessage(
        "Connection status is unavailable in this tab. Enable session storage before starting a connection.",
      );
    }
  }, [storageKey]);
  const refresh = useCallback(async () => {
    // Refresh every already displayed page with exact keys; no unrelated dashboard cache.
    await Promise.all(
      client
        .getQueryCache()
        .findAll({ queryKey: ["gateway-accounts", scope, "page"] })
        .map((query) =>
          client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
        ),
    );
    await refreshRelated?.();
    await optionsCache?.refresh();
  }, [client, scope, refreshRelated, optionsCache]);
  const offerCompletionHandoff = useCallback((nonce: string) => {
    if (completionHandoffRef.current) return;
    completionHandoffRef.current = nonce;
    setCompletionHandoff(nonce);
  }, []);
  const consumeCompletionHandoff = useCallback((nonce: string) => {
    if (completionHandoffRef.current !== nonce) return;
    completionHandoffRef.current = null;
    setCompletionHandoff((current) => (current === nonce ? null : current));
  }, []);
  function reserveNonce(): string | null {
    if (!ready || nonces.length >= 8) {
      setMessage(
        "Check recent connections or hide old results before starting another.",
      );
      return null;
    }
    const nonce = crypto.randomUUID();
    try {
      const next = [...savedNonces(storageKey), nonce];
      if (next.length > 8) throw new Error();
      // Persist BEFORE request entry: a lost response/reload preserves the operation identity.
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setNonces(next);
      return nonce;
    } catch {
      setMessage(
        "Could not preserve connection status. Nothing was submitted.",
      );
      return null;
    }
  }
  function dismiss(nonce: string) {
    try {
      const next = savedNonces(storageKey).filter((n) => n !== nonce);
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setNonces(next);
    } catch {
      setMessage("Could not update connection status.");
    }
  }
  async function accept(
    nonce: string,
    result: AccountsResult<AccountOperationView>,
  ) {
    await client.cancelQueries({
      queryKey: operationKey(scope, nonce),
      exact: true,
    });
    client.setQueryData(operationKey(scope, nonce), result);
    if (result.status !== "ok") dismiss(nonce); // Adapter proved no management mutation entered.
    setMessage(
      result.status === "ok"
        ? result.value.state === "applied"
          ? personal
            ? "The personal account request finished. Sharing and model selection remain separate actions."
            : "The connection request finished. Workspace use may still require selecting an account."
          : result.value.state === "rejected"
            ? "The connection request was declined."
            : "We could not confirm this connection request. Check its status later; it will not be submitted twice."
        : statusText(result.status, managementScope),
    );
    await refresh();
  }
  async function beginOAuth(intent: OAuthFormIntent) {
    if (submitting.current) return;
    let tab: Window | null = null;
    let nonce: string | null;
    try {
      tab = window.open("about:blank", "_blank");
      if (!tab) throw new Error();
      tab.opener = null;
      const referrer = tab.document.createElement("meta");
      referrer.name = "referrer";
      referrer.content = "no-referrer";
      tab.document.head.append(referrer);
      nonce = reserveNonce();
    } catch {
      tab?.close();
      setMessage(
        "Could not open a safe authorization tab. Allow popups and try again. Nothing was submitted.",
      );
      return;
    }
    if (!nonce) {
      tab.close();
      return;
    }
    submitting.current = true;
    setBusy(true);
    let navigated = false;
    let completionReady = false;
    try {
      // Direct ingress: neither the Begin response nor its temporary URL enters
      // a query/mutation cache, component state, storage or a readback request.
      const fresh = await api.beginGatewayOAuth(context, { ...intent, nonce });
      const safe: AccountsResult<AccountOperationView> =
        fresh.status === "ok"
          ? fresh.value.operation.nonce === nonce
            ? { status: "ok", value: fresh.value.operation }
            : {
                status: "ok",
                value: { nonce, state: "unknown", cleanup: "unresolved" },
              }
          : fresh;
      const authorizationURL =
        fresh.status === "ok" ? fresh.value.authorizationURL : undefined;
      // The browser gets one fresh handoff. Readback never contains/rebuilds a URL.
      if (
        fresh.status === "ok" &&
        validAuthorizationURL(authorizationURL) &&
        fresh.value.operation.nonce === nonce &&
        fresh.value.operation.state === "pending" &&
        !tab.closed
      ) {
        const link = tab.document.createElement("a");
        link.target = "_self";
        link.rel = "noreferrer";
        link.referrerPolicy = "no-referrer";
        link.href = authorizationURL;
        try {
          link.click();
          navigated = true;
          completionReady = true;
        } finally {
          link.removeAttribute("href");
        }
      } else tab.close();
      if (completionReady) offerCompletionHandoff(nonce);
      await accept(nonce, safe);
    } catch {
      if (!navigated) tab.close();
      await accept(nonce, {
        status: "ok",
        value: { nonce, state: "unknown", cleanup: "unresolved" },
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const metadataMutation = useMutation({
    mutationKey: ["gateway-accounts", scope, "metadata"] as const,
    mutationFn: (intent: AccountIntent) =>
      api.mutateGatewayAccount(context, intent),
    retry: false,
    gcTime: 0,
  });
  async function submit(
    intent: Omit<AccountIntent, "nonce">,
    credential?: string,
  ) {
    if (submitting.current) return;
    const nonce = reserveNonce();
    if (!nonce) return;
    submitting.current = true;
    setBusy(true);
    try {
      // Secrets bypass React Query entirely. Its mutation cache receives safe metadata only.
      const request = { ...intent, nonce };
      const result =
        credential === undefined
          ? await metadataMutation.mutateAsync(request)
          : await api.submitGatewayApiKey(context, request, credential);
      await accept(nonce, result);
    } catch {
      await accept(nonce, {
        status: "ok",
        value: { nonce, state: "unknown", cleanup: "unresolved" },
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const bindingMutation = useMutation({
    mutationKey: ["gateway-accounts", scope, "binding"] as const,
    mutationFn: (account: AccountView) =>
      bindGatewayAccount(context, {
        connectionId: account.connectionId,
        mirrorRevision: account.mirrorRevision,
        gatewayRevision: account.gatewayRevision,
        bindingRevision: account.binding?.revision ?? 0,
      }),
    retry: false,
    gcTime: 0,
    onSuccess: async (result) => {
      setMessage(
        result.status === "ok"
          ? `${result.value.label} is available for workspace model selection.`
          : statusText(result.status),
      );
      await refresh();
    },
    onError: () =>
      setMessage("Binding status is unavailable. Refresh Accounts."),
  });
  const loaded = page.data.pages.filter((result) => result.status === "ok");
  const failure = page.data.pages.find((result) => result.status !== "ok");
  const data = loaded.length
    ? {
        status: "ok" as const,
        value: {
          ...loaded[0]!.value,
          accounts: [
            ...new Map(
              loaded
                .flatMap((result) => result.value.accounts)
                .map((account) => [account.connectionId, account]),
            ).values(),
          ],
          profiles: [
            ...new Map(
              loaded
                .flatMap((result) => result.value.profiles)
                .map((profile) => [profile.id, profile]),
            ).values(),
          ],
        },
      }
    : failure;

  const detachMutation = useMutation({
    mutationFn: (account: AccountView) =>
      detachGatewayAccount(context, {
        connectionId: account.connectionId,
        expectedRevision: account.binding!.revision,
      }),
    retry: false,
    onSuccess: async (result) => {
      setMessage(
        result.status === "ok"
          ? `Workspace use detached; ${result.value.remoteFenceDelivery === "remote_applied" ? "gateway fence acknowledged" : "gateway fence pending"}.`
          : statusText(result.status),
      );
      await refresh();
    },
  });
  const disabled =
    busy ||
    !ready ||
    bindingMutation.isPending ||
    detachMutation.isPending ||
    page.isFetching ||
    data?.status !== "ok";
  function renderActions(account: AccountView) {
    if (data?.status !== "ok") return null;
    const sourceBusy =
      disabled || lifecycleActivities.has(account.connectionId);
    const manageReason = sourceBusy
      ? "The connection is updating — try again later."
      : account.canManage !== true
        ? "You cannot manage this connection."
        : undefined;
    const bindReason = sourceBusy
      ? "The connection is updating — try again later."
      : account.state !== "active"
        ? "The account is inactive — enable it first."
        : account.binding?.fencePending
          ? "Workspace binding in progress — please wait."
          : account.canManage !== true
            ? "You cannot manage this connection."
            : undefined;
    return (
      <>
        {account.state !== "disabled" && account.state !== "tombstoned" ? (
          <AccountForm
            account={account}
            mode="rename"
            profiles={data.value.profiles}
            disabled={sourceBusy || account.canManage !== true}
            disabledReason={manageReason}
            managementScope={managementScope}
            submit={submit}
          />
        ) : null}
        {account.authKind === "api_key" &&
        account.state !== "disabled" &&
        account.state !== "tombstoned" &&
        data.value.profiles.find((p) => p.id === account.profileId)
          ?.canReconnect ? (
          <AccountForm
            account={account}
            mode="reconnect"
            profiles={data.value.profiles}
            disabled={sourceBusy || account.canManage !== true}
            disabledReason={manageReason}
            submit={submit}
            managementScope={managementScope}
          />
        ) : null}
        {account.authKind === "oauth" &&
        account.state !== "disabled" &&
        account.state !== "tombstoned" &&
        data.value.profiles.find((p) => p.id === account.profileId)
          ?.canReconnect ? (
          <OAuthForm
            account={account}
            profiles={data.value.profiles.filter(
              (p) => p.id === account.profileId,
            )}
            disabled={sourceBusy || account.canManage !== true}
            disabledReason={manageReason}
            begin={beginOAuth}
            managementScope={managementScope}
          />
        ) : null}
        {!personal && account.binding?.state !== "active" ? (
          <AccountMenuItem>
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={
                sourceBusy ||
                account.state !== "active" ||
                Boolean(account.binding?.fencePending) ||
                account.canManage !== true
              }
              title={bindReason}
              onClick={() => bindingMutation.mutate(account)}
            >
              Add to this workspace
            </Button>
          </AccountMenuItem>
        ) : null}
        {!personal && account.binding?.state === "active" ? (
          <AccountMenuItem>
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={disabled}
              title={
                disabled ? "Wait for the current refresh to finish." : undefined
              }
              onClick={() => detachMutation.mutate(account)}
            >
              {accountsCopy.detach}
            </Button>
          </AccountMenuItem>
        ) : null}
      </>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {!hideConnect &&
        data?.status === "ok" &&
        data.value.profiles.some(
          (p) => p.authKind === "api_key" || p.authKind === "oauth",
        ) ? (
          <AccountActionsMenu
            label={personal ? accountsCopy.connect : accountsCopy.add}
            triggerContent={
              <>
                <Plus aria-hidden="true" className="size-4" />
                {personal ? accountsCopy.connect : accountsCopy.add}
              </>
            }
          >
            {data.value.profiles.some((p) => p.authKind === "api_key") ? (
              <AccountForm
                accounts={data.value.accounts}
                profiles={data.value.profiles.filter(
                  (p) => p.authKind === "api_key",
                )}
                disabled={disabled}
                disabledReason={
                  disabled
                    ? "Wait for the current refresh to finish."
                    : undefined
                }
                managementScope={managementScope}
                submit={submit}
              />
            ) : null}
            {data.value.profiles.some((p) => p.authKind === "oauth") ? (
              <OAuthForm
                accounts={data.value.accounts}
                profiles={data.value.profiles.filter(
                  (p) => p.authKind === "oauth",
                )}
                disabled={disabled}
                disabledReason={
                  disabled
                    ? "Wait for the current refresh to finish."
                    : undefined
                }
                managementScope={managementScope}
                begin={beginOAuth}
              />
            ) : null}
          </AccountActionsMenu>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh connections"
          disabled={!context || page.isFetching}
          title={
            !context
              ? "The connection context is unavailable."
              : page.isFetching
                ? "The connection list is being refreshed."
                : undefined
          }
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm text-slate-300">
          {message}
        </p>
      ) : null}
      {page.isError || failure ? (
        <p role="status">
          Connection details could not be refreshed. Workspace access remains
          separate.
        </p>
      ) : null}
      {connectOnly ? null : renderAccounts ? (
        renderAccounts(
          data?.status === "ok" ? data.value.accounts : [],
          renderActions,
        )
      ) : data?.status !== "ok" ? (
        <p role="status" className="text-sm text-slate-400">
          {statusText(data?.status ?? "unavailable", managementScope)}
        </p>
      ) : (
        <div className="divide-y divide-cyan-200/10">
          {!data.value.accounts.length ? (
            <p className="py-4 text-sm text-slate-400">
              {personal
                ? "No personal accounts on this page."
                : "No workspace accounts on this page."}
            </p>
          ) : null}
          {data.value.accounts.map((account) => (
            <div
              key={account.connectionId}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div>
                <p className="font-medium text-cyan-50">{account.label}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {account.profileLabel} ·{" "}
                  {
                    data.value.profiles.find((p) => p.id === account.profileId)
                      ?.protocol
                  }
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="neutral">{account.state}</Badge>
                  {personalAccountOriginText(account) ? (
                    <Badge tone="neutral">
                      {personalAccountOriginText(account)}
                    </Badge>
                  ) : null}
                  {account.binding ? (
                    <Badge tone="neutral">
                      {account.binding.fencePending
                        ? "Binding locally denied; remote fence pending"
                        : account.binding.state === "active"
                          ? "Workspace binding ready"
                          : "Binding revoked"}
                    </Badge>
                  ) : null}
                </div>
                {account.state === "quarantined" ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Connection could not be confirmed. Use a supported reconnect
                    action if available, or check the original request below.
                  </p>
                ) : null}
                {account.state === "disabled" ||
                account.state === "tombstoned" ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Logical denial only; credential erasure and transport
                    cleanup are unverified.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {!personal &&
                account.binding?.state === "active" &&
                !account.binding.fencePending ? (
                  <a
                    className="text-sm text-cyan-200 underline"
                    href={dashboardSectionHref("policy", workspaceId)}
                  >
                    Choose for reviews
                  </a>
                ) : null}
                {renderActions(account)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!connectOnly && page.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          disabled={page.isFetching}
          onClick={() => void page.fetchNextPage()}
        >
          Load more connection details
        </Button>
      ) : null}
      {nonces.length ? (
        <div className="space-y-2 border-t border-cyan-200/10 pt-4">
          <h4 className="text-sm font-semibold text-cyan-50">
            Connection status
          </h4>
          <p className="text-xs text-slate-400">
            Track recent connection requests here. Pending Codex authorizations
            can be resumed below. A request is never submitted twice, and
            checking its status never opens a new authorization tab.
          </p>
          {nonces.map((nonce, index) => (
            <OperationReadback
              key={nonce}
              context={context}
              scope={scope}
              nonce={nonce}
              index={index + 1}
              dismiss={() => dismiss(nonce)}
              refresh={refresh}
              autoOpenCompletion={completionHandoff === nonce}
              consumeCompletionHandoff={() => consumeCompletionHandoff(nonce)}
              oauthEnabled={
                data?.status === "ok" &&
                data.value.profiles.some((p) => p.authKind === "oauth")
              }
              api={api}
              managementScope={managementScope}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OAuthForm({
  account,
  accounts = [],
  profiles,
  disabled,
  disabledReason,
  begin,
  managementScope = "workspace",
}: {
  account?: AccountView;
  accounts?: AccountView[];
  profiles: AccountProfileView[];
  disabled: boolean;
  disabledReason?: string | undefined;
  begin(intent: OAuthFormIntent): Promise<void>;
  managementScope?: ManagementScope;
}) {
  const menuReturnFocus = useAccountMenuReturnFocus();
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AccountMenuItem>
        <Dialog.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
            />
          }
        >
          {account ? accountsCopy.reconnectOAuth : accountsCopy.connectOAuth}
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup finalFocus={menuReturnFocus}>
          <Dialog.Title>
            {account
              ? `${accountsCopy.reconnectOAuth} · ${account.label}`
              : accountsCopy.connectOAuth}
          </Dialog.Title>
          <Dialog.Description>
            Codex sign-in opens in a new browser tab. No API key is needed. The
            connection stays pending until it is confirmed; if the outcome is
            uncertain, wait for a status check. When reconnecting, the logical
            account is kept until the new authorization is verified.
            {managementScope === "personal"
              ? " This is your canonical personal connection. Its name is visible wherever you explicitly share it; authentication is shared across all authorized uses."
              : ""}
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const intent: OAuthFormIntent = account
                ? {
                    connectionId: account.connectionId,
                    gatewayRevision: account.gatewayRevision,
                    mirrorRevision: account.mirrorRevision,
                  }
                : {
                    profileId: String(values.get("profileId") ?? ""),
                    label:
                      String(values.get("label") ?? "").trim() ||
                      suggestedAccountLabel(
                        profiles[0]?.label ?? "Codex",
                        accounts.map((a) => a.label),
                      ),
                  };
              form.reset();
              setOpen(false);
              void begin(intent);
            }}
          >
            {!account ? (
              <>
                <SelectField
                  name="profileId"
                  label="Provider profile"
                  defaultValue={profiles[0]?.id ?? ""}
                  options={profiles.map((p) => ({
                    value: p.id,
                    label: `${p.label} · ${p.protocol}`,
                    description: p.models.join(", "),
                  }))}
                />
                <label className="grid gap-2 text-sm">
                  Connection name
                  <input
                    className={inputClass}
                    name="label"
                    defaultValue={suggestedAccountLabel(
                      profiles[0]?.label ?? "Codex",
                      accounts.map((a) => a.label),
                    )}
                    maxLength={120}
                  />
                </label>
              </>
            ) : (
              <p className="text-sm text-slate-300">{account.label}</p>
            )}
            <Button type="submit" disabled={disabled}>
              Sign in to Codex
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OperationReadback({
  context,
  scope,
  nonce,
  index,
  dismiss,
  refresh,
  oauthEnabled,
  autoOpenCompletion,
  consumeCompletionHandoff,
  api,
  managementScope,
}: {
  context: string;
  scope: string;
  nonce: string;
  index: number;
  dismiss(): void;
  refresh(): Promise<void>;
  oauthEnabled: boolean;
  autoOpenCompletion: boolean;
  consumeCompletionHandoff(): void;
  api: AccountGatewayManagementApi;
  managementScope: ManagementScope;
}) {
  const client = useQueryClient();
  const [pollUntil] = useState(() => Date.now() + 60000);
  const [completionOffered, setCompletionOffered] = useState(false);
  const [completionSpent, setCompletionSpent] = useState(false);
  const [keyContinuationSpent, setKeyContinuationSpent] = useState(false);
  const keyContinuationEntered = useRef(false);
  const keyContinuationInFlight = useRef(false);
  const keyContinuationGeneration = useRef(0);
  const keyStatusCheckInFlight = useRef(false);
  const originalKeyResume = useRef<AccountOperationView["resume"]>(undefined);
  const [keyContinuationBusy, setKeyContinuationBusy] = useState(false);
  const operation = useQuery({
    queryKey: operationKey(scope, nonce),
    queryFn: () => api.readGatewayOperation(context, nonce),
    staleTime: 3000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.status === "ok" &&
      query.state.data.value.state === "pending" &&
      Date.now() < pollUntil
        ? 3000
        : false,
  });
  const data = operation.data;
  const state = data?.status === "ok" ? data.value.state : "unresolved";
  useEffect(() => {
    if (state === "applied") void refresh();
  }, [state, refresh]); // refresh exact account pages after promotion
  const keyResume =
    managementScope === "personal" && data?.status === "ok"
      ? data.value.resume
      : undefined;
  async function continueKeyUpdate(credential: string) {
    if (keyContinuationEntered.current || !keyResume || state !== "pending")
      return;
    const selectedResume = { ...keyResume };
    keyContinuationEntered.current = true;
    keyContinuationInFlight.current = true;
    keyContinuationGeneration.current++;
    originalKeyResume.current = selectedResume;
    setKeyContinuationBusy(true);
    setKeyContinuationSpent(true);
    const queryKey = operationKey(scope, nonce);
    let result: AccountsResult<AccountOperationView> = {
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    };
    try {
      try {
        // Cancel the old ready read before entry; no secret is a query/mutation variable.
        await client.cancelQueries({ queryKey, exact: true });
        const returned = await api.submitGatewayApiKey(
          context,
          { ...selectedResume, nonce },
          credential,
        );
        if (returned.status === "ok" && returned.value.nonce === nonce)
          result = returned;
      } catch {
        // Any uncertain submission is readback-only under this original nonce.
      }
      // A ready read may have started during the direct request. Cancel it before publish.
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData(queryKey, result);
      await refresh();
    } finally {
      keyContinuationInFlight.current = false;
      setKeyContinuationBusy(false);
    }
  }
  async function checkStatus() {
    if (keyStatusCheckInFlight.current) return;
    keyStatusCheckInFlight.current = true;
    // Only a user check begun after request completion may accept a new ready proof.
    const mayRearm =
      managementScope === "personal" &&
      keyContinuationEntered.current &&
      !keyContinuationInFlight.current;
    const generation = keyContinuationGeneration.current;
    try {
      const checked = await operation.refetch();
      const fresh = checked.data;
      const resume = fresh?.status === "ok" ? fresh.value.resume : undefined;
      const original = originalKeyResume.current;
      if (
        mayRearm &&
        !checked.isError &&
        !checked.isFetching &&
        !keyContinuationInFlight.current &&
        generation === keyContinuationGeneration.current &&
        fresh?.status === "ok" &&
        fresh.value.nonce === nonce &&
        fresh.value.state === "pending" &&
        resume &&
        original &&
        resume.kind === original.kind &&
        resume.connectionId === original.connectionId &&
        resume.profileId === original.profileId &&
        resume.gatewayRevision === original.gatewayRevision &&
        resume.mirrorRevision === original.mirrorRevision
      ) {
        keyContinuationEntered.current = false;
        setKeyContinuationSpent(false);
      }
    } finally {
      keyStatusCheckInFlight.current = false;
    }
  }
  const terminal = state === "applied" || state === "rejected";
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
      <span>
        Connection {index} · {operationStateText(state)}
        {data?.status === "ok" && data.value.account
          ? ` · ${data.value.account.label}`
          : ""}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={operation.isFetching || keyContinuationBusy}
        onClick={() => void checkStatus()}
      >
        Check status
      </Button>
      {state === "pending" && keyResume && !keyContinuationSpent ? (
        <KeyUpdateContinuation submit={continueKeyUpdate} />
      ) : null}
      {state === "pending" &&
      !keyResume &&
      (oauthEnabled || autoOpenCompletion || completionOffered) ? (
        <OAuthCompletionForm
          completeOAuth={api.completeGatewayOAuth}
          managementScope={managementScope}
          context={context}
          nonce={nonce}
          autoOpen={autoOpenCompletion}
          consumeAutoOpen={() => {
            setCompletionOffered(true);
            consumeCompletionHandoff();
          }}
          spent={completionSpent}
          spend={() => setCompletionSpent(true)}
          restorePreEntry={() => setCompletionSpent(false)}
          accept={async (result) => {
            await client.cancelQueries({
              queryKey: operationKey(scope, nonce),
              exact: true,
            });
            client.setQueryData(operationKey(scope, nonce), result);
            await refresh();
          }}
        />
      ) : null}
      {terminal || state === "unknown" ? (
        <Button variant="outline" size="sm" onClick={dismiss}>
          {state === "unknown" ? "Hide" : "Dismiss"}
        </Button>
      ) : null}
    </div>
  );
}

function KeyUpdateContinuation({
  submit,
}: {
  submit(credential: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const entered = useRef(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AccountMenuItem>
        <Dialog.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
            />
          }
        >
          Continue key update
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Continue key update</Dialog.Title>
          <Dialog.Description>
            Old review access is blocked. Enter the new key to continue this
            original account update.
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (entered.current) return;
              entered.current = true;
              const form = event.currentTarget;
              const values = new FormData(form);
              const credential = String(values.get("credential") ?? "");
              form.reset();
              values.delete("credential");
              setOpen(false);
              void submit(credential);
            }}
          >
            <label className="grid gap-2 text-sm">
              API key
              <input
                className={inputClass}
                name="credential"
                type="password"
                required
                maxLength={16384}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="flex gap-3">
              <Button type="submit">Continue update</Button>
              <Dialog.Close render={<Button type="button" variant="outline" />}>
                Cancel
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OAuthCompletionForm({
  context,
  nonce,
  autoOpen,
  consumeAutoOpen,
  spent,
  spend,
  restorePreEntry,
  accept,
  completeOAuth,
  managementScope,
}: {
  context: string;
  nonce: string;
  autoOpen: boolean;
  consumeAutoOpen(): void;
  spent: boolean;
  spend(): void;
  restorePreEntry(): void;
  accept(result: AccountsResult<AccountOperationView>): Promise<void>;
  completeOAuth: AccountGatewayManagementApi["completeGatewayOAuth"];
  managementScope: ManagementScope;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    if (!autoOpen) return;
    if (!spent) setOpen(true);
    consumeAutoOpen();
  }, [autoOpen, consumeAutoOpen, spent]);
  async function complete(callbackURL: string) {
    if (submitting.current || spent) return;
    submitting.current = true;
    spend(); // The nonce owner retains this across child unmounts and stale polls.
    setBusy(true);
    setMessage("");
    try {
      // A one-off server action is the only destination for the transient URL.
      const result = await completeOAuth(context, {
        nonce,
        callbackURL,
      });
      if (result.status !== "ok") {
        // The server returns ok/unknown after sensitive ingress has entered.
        if (result.status === "invalid" || result.status === "denied")
          restorePreEntry();
        setMessage(statusText(result.status, managementScope));
        return;
      }
      setOpen(false);
      await accept(result);
    } catch {
      setOpen(false);
      await accept({
        status: "ok",
        value: { nonce, state: "unknown", cleanup: "unresolved" },
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AccountMenuItem>
        <Dialog.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={busy || spent}
              title={
                busy
                  ? "Submitting the authorization result — please wait."
                  : spent
                    ? "Authorization is already complete."
                    : undefined
              }
            />
          }
        >
          Resume Codex authorization
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Complete Codex authorization</Dialog.Title>
          <Dialog.Description>
            Finish authorizing Codex in the browser tab opened for this
            connection. If that tab cannot return here, copy its full web
            address and paste it below. The address is cleared as soon as you
            submit it.
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const field = form.elements.namedItem(
                "callbackURL",
              ) as HTMLInputElement;
              const callbackURL = field.value;
              field.value = "";
              form.reset(); // Clear the uncontrolled secret BEFORE any await.
              void complete(callbackURL);
            }}
          >
            <label className="grid gap-2 text-sm">
              Authorization result address
              <input
                className={inputClass}
                type="text"
                name="callbackURL"
                autoComplete="off"
                spellCheck={false}
                required
                maxLength={8192}
                disabled={busy || spent}
              />
            </label>
            {message ? <p role="status">{message}</p> : null}
            <Button type="submit" disabled={busy || spent}>
              Complete authorization
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountForm({
  account,
  accounts = [],
  mode = "connect",
  profiles,
  disabled,
  disabledReason,
  submit,
  managementScope = "workspace",
}: {
  account?: AccountView;
  accounts?: AccountView[];
  mode?: "connect" | "rename" | "reconnect";
  profiles: AccountProfileView[];
  disabled: boolean;
  disabledReason?: string | undefined;
  managementScope?: ManagementScope;
  submit(
    intent: Omit<AccountIntent, "nonce">,
    credential?: string,
  ): Promise<void>;
}) {
  const menuReturnFocus = useAccountMenuReturnFocus();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const selected = profiles.find((p) => p.id === selectedId);
  const [labelValue, setLabelValue] = useState(account?.label ?? "");
  const [automaticLabel, setAutomaticLabel] = useState(!account);
  const [manualURL, setManualURL] = useState(false);
  const [baseURL, setBaseURL] = useState(selected?.dedicatedBaseURL ?? "");
  const suggestion = (profile?: AccountProfileView) =>
    suggestedAccountLabel(
      profile?.label ?? "Provider",
      accounts.map((a) => a.label),
    );
  const needsMimoURL = mode === "connect" && selected?.label === "MiMo";
  const endpointValid =
    !needsMimoURL ||
    (Boolean(selected.dedicatedBaseURL) &&
      canonicalMimoBaseURL(baseURL) === selected.dedicatedBaseURL);
  const title =
    mode === "rename"
      ? accountsCopy.rename
      : mode === "reconnect"
        ? accountsCopy.reconnectKey
        : accountsCopy.connectKey;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next && mode !== "connect") setLabelValue(account?.label ?? "");
        if (next && mode === "connect") {
          setSelectedId(profiles[0]?.id ?? "");
          setBaseURL(profiles[0]?.dedicatedBaseURL ?? "");
          setManualURL(false);
          setAutomaticLabel(true);
          setLabelValue(suggestion(profiles[0]));
        }
        setOpen(next);
      }}
    >
      <AccountMenuItem>
        <Dialog.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
            />
          }
        >
          {title}
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup finalFocus={menuReturnFocus}>
          <Dialog.Title>
            {title}
            {account ? ` · ${account.label}` : ""}
          </Dialog.Title>
          <Dialog.Description>
            {mode === "rename"
              ? "Update the friendly account label."
              : "Connect your provider account with an API key. The key is saved securely and cannot be viewed here."}
            {managementScope === "personal"
              ? mode === "reconnect"
                ? " This updates your same personal connection for all its authorized uses. Old review access will be invalidated."
                : " The canonical name is visible in every organization where you explicitly share this account."
              : ""}
          </Dialog.Description>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const credential =
                mode === "rename"
                  ? undefined
                  : String(values.get("credential") ?? "");
              const intent: Omit<AccountIntent, "nonce"> = account
                ? {
                    kind: mode,
                    connectionId: account.connectionId,
                    gatewayRevision: account.gatewayRevision,
                    mirrorRevision: account.mirrorRevision,
                    ...(mode === "rename"
                      ? { label: String(values.get("label") ?? "") }
                      : {}),
                  }
                : {
                    kind: "connect",
                    profileId: String(values.get("profileId") ?? ""),
                    label:
                      String(values.get("label") ?? "").trim() ||
                      suggestion(selected),
                    ...(needsMimoURL ? { baseURL } : {}),
                  };
              form.reset();
              values.delete("credential");
              setOpen(false);
              void submit(intent, credential);
            }}
          >
            {mode === "connect" ? (
              <SelectField
                name="profileId"
                label="Provider profile"
                defaultValue={profiles[0]?.id ?? ""}
                onValueChange={(value) => {
                  const profile = profiles.find((p) => p.id === value);
                  setSelectedId(value);
                  setBaseURL(profile?.dedicatedBaseURL ?? "");
                  setManualURL(false);
                  if (automaticLabel) setLabelValue(suggestion(profile));
                }}
                options={profiles.map((p) => ({
                  value: p.id,
                  label: `${p.label} · ${p.protocol}`,
                  description: p.models.join(", "),
                }))}
              />
            ) : null}
            {needsMimoURL ? (
              <>
                <SelectField
                  key={selectedId}
                  name="endpointPreset"
                  label="Dedicated Base URL"
                  defaultValue={selected.dedicatedBaseURL ?? "manual"}
                  options={[
                    ...mimoTokenPlanEndpoints.map((endpoint) => ({
                      value: endpoint.baseURL,
                      label: endpoint.label,
                      description:
                        endpoint.baseURL === selected.dedicatedBaseURL
                          ? endpoint.baseURL
                          : "Not available here yet",
                      disabled: endpoint.baseURL !== selected.dedicatedBaseURL,
                    })),
                    { value: "manual", label: "Enter URL manually" },
                  ]}
                  onValueChange={(value) => {
                    setManualURL(value === "manual");
                    if (value !== "manual") setBaseURL(value);
                  }}
                />
                {manualURL ? (
                  <label className="grid gap-2 text-sm">
                    Base URL from your Token Plan
                    <input
                      className={inputClass}
                      type="url"
                      value={baseURL}
                      onChange={(event) => setBaseURL(event.target.value)}
                      maxLength={2048}
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                <p className="text-xs text-slate-400">
                  Copy your dedicated API key and OpenAI Base URL from your{" "}
                  <a
                    className="underline"
                    href="https://platform.xiaomimimo.com/console/plan-manage"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MiMo Token Plan
                  </a>
                  . Token Plan and pay-as-you-go keys use different endpoints.
                  {!selected.dedicatedBaseURL
                    ? " URL setup is not available here yet."
                    : !endpointValid
                      ? " Use the enabled regional URL; other regions are not available here yet."
                      : ""}
                </p>
              </>
            ) : null}
            {mode !== "reconnect" ? (
              <label className="grid gap-2 text-sm">
                Connection name{mode === "connect" ? " (optional)" : ""}
                <input
                  className={inputClass}
                  name="label"
                  required={mode === "rename"}
                  maxLength={120}
                  value={labelValue}
                  placeholder={suggestion(selected)}
                  onChange={(event) => {
                    setLabelValue(event.target.value);
                    setAutomaticLabel(!event.target.value.trim());
                  }}
                />
              </label>
            ) : null}
            {mode !== "rename" ? (
              <label className="grid gap-2 text-sm">
                API key
                <input
                  className={inputClass}
                  name="credential"
                  type="password"
                  required
                  maxLength={16384}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ) : null}
            <Button type="submit" disabled={disabled || !endpointValid}>
              Confirm
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
