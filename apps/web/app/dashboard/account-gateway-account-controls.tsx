"use client";

import {
  OAuthForm,
  type OAuthFormIntent,
} from "./legacy-oauth-connection-form";
import {
  NativeConnectionForm,
  type NativeConnectionSubmission,
} from "./native-connection-form";

import {
  canCreateConnection,
  type CredentialImportMethod,
} from "../../src/features/account-gateway/connection-capabilities";
import {
  CredentialImportFields,
  validCredentialImportText,
} from "./credential-import-fields";

import {
  AccountLimitsLine,
  AccountLimitsReadContext,
} from "./account-limits-line";
import {
  accountLimitsScope,
  extractAccountLimits,
  releaseAccountLimits,
  removeAccountLimitsForConnection,
  removeAccountLimits,
} from "./account-limits-query";

import { useAccountLifecycleActivities } from "../../src/features/account-gateway/interface/hooks/use-account-lifecycle-activities";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import {
  apiKeyProviderForGatewayProfile,
  apiKeySetupHref,
  apiKeyStorageLabel,
  type ApiKeyStorage,
} from "../../src/features/provider-setup/api-key-storage";
import {
  connectsInProviderDialog,
  getSetupProvider,
  setupProviderForGatewayProfile,
} from "../../src/features/provider-setup/setup-provider";
import { ApiKeyStorageChoice } from "./provider-setup/api-key-storage-choice";
import {
  AccountMenuItem,
  accountMenuItemClass,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import { Copy, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import { ChooseForReviewsLink } from "./choose-for-reviews-link";
import {
  accountsCopy,
  connectionRowStatus,
  removedFromWorkspaceText,
} from "./accounts-copy";
import { bindingWorkspaceUse, WorkspaceUseLine } from "./account-workspace-use";
import { useConnectTarget } from "./account-connect-target";
import { dashboardPath } from "./dashboard-section";
import { refreshPersonalAccountViews } from "./personal-account-controls";
import { AccountIdentity, AccountProviderLogo } from "./account-identity";
import { AccountStatusLine } from "./account-status-icon";
import { readAccountResult } from "./account-read-result";
import {
  type ConnectWorkspaceAttachment,
  type PersonalAccountsResult,
} from "../../src/features/account-gateway/personal-accounts";
import {
  canonicalMimoBaseURL,
  mimoTokenPlanEndpoints,
  suggestedAccountLabel,
  subscriptionKeyURL,
} from "../../src/features/account-gateway/connection-options";
import {
  oauthCompletionPresentation,
  operationStateText,
  validAuthorizationURL,
  type OAuthCompletionPresentation,
} from "./account-connection-presentation";
import type {
  AccountIntent,
  AccountOperationView,
  AccountProfileView,
  AccountView,
  AccountsBootstrap,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  bindGatewayAccount,
  beginGatewayOAuth,
  beginGatewayNativeConnection,
  continueGatewayNativeConnection,
  completeGatewayOAuth,
  pollGatewayOAuth,
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
> & {
  beginGatewayNativeConnection?: typeof beginGatewayNativeConnection;
  continueGatewayNativeConnection?: typeof continueGatewayNativeConnection;
  pollGatewayOAuth?: (
    context: string,
    nonce: string,
  ) => Promise<AccountsResult<AccountOperationView>>;
};
const defaultManagementApi = {
  listGatewayAccounts,
  mutateGatewayAccount,
  submitGatewayApiKey,
  readGatewayOperation,
  beginGatewayOAuth,
  beginGatewayNativeConnection,
  continueGatewayNativeConnection,
  completeGatewayOAuth,
  pollGatewayOAuth,
};
export type AccountRowsRenderer = (
  accounts: readonly AccountView[],
  actions: (account: AccountView) => ReactNode,
) => ReactNode;

type ManagementScope = "workspace" | "personal";
/** Server action bound to the current workspace; adds a just-connected
 * personal connection there when its owner may grant it. */
export type AddConnectionToWorkspace = (
  connectNonce: string,
) => Promise<PersonalAccountsResult<ConnectWorkspaceAttachment>>;

// Legacy Claude OAuth accounts remain readable, but customers may only enroll
// subscription credentials locally in their own GitHub Actions CLI workflow.
const centrallyEnrollAllowed = (profile: AccountProfileView) =>
  (profile.connection?.nativeMethods !== undefined ||
    profile.id !== "anthropic-claude-oauth-messages-v1") &&
  canCreateConnection(profile);

// Small safe keys: scoped stable user/workspace locator; no signature or secret.
const pageKey = (scope: string, cursor: string | null) =>
  ["gateway-accounts", scope, "page", cursor] as const;
/** Same-tab signal: a view saved or dismissed a connection of this owner. */
const operationsChangedEvent = "rr-account-operations-changed";
const announceOperationsChanged = (storageKey: string) =>
  window.dispatchEvent(
    new CustomEvent(operationsChangedEvent, { detail: storageKey }),
  );
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
// A connect started while viewing a workspace records that workspace with its
// nonce. Only that workspace may receive it automatically; nonces without a
// record (rename, reconnect, requests from before this record) never attach.
function savedConnectWorkspaces(
  key: string,
  nonces: readonly string[],
): Record<string, string> {
  const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(
    nonces.flatMap((nonce) => {
      const workspaceId = (saved as Record<string, unknown>)[nonce];
      return typeof workspaceId === "string" && workspaceId.length <= 160
        ? [[nonce, workspaceId] as const]
        : [];
    }),
  );
}
type DeviceAuthorization = {
  userCode: string;
  verificationURL: string;
  expiresAt: string;
  intervalSeconds: number;
};
const inputClass =
  "min-h-11 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-cyan-50";
const keyUnconfirmedText =
  "The key was not confirmed as saved. Use Check status to see the current state before entering it again.";
function statusText(
  status: AccountsResult<unknown>["status"],
  managementScope: ManagementScope = "workspace",
) {
  return status === "denied"
    ? managementScope === "personal"
      ? "Sign in as the owner of this personal account."
      : "You need workspace owner or admin access."
    : status === "conflict"
      ? "The account changed. Refresh connections before trying again."
      : status === "invalid"
        ? "Check the account fields."
        : "Account management is unavailable. Refresh or check the connection later.";
}

const ConnectWorkspaceContext = createContext<{
  workspaceId?: string | undefined;
}>({});

export function AccountGatewayControls({
  bootstrap,
  api = defaultManagementApi,
  managementScope = "workspace",
  queryClient,
  renderAccounts,
  hideToolbar = false,
  connectEntry,
  connectOnly = false,
  workspaceId,
  addToWorkspace,
}: {
  bootstrap: AccountsBootstrap;
  api?: AccountGatewayManagementApi;
  managementScope?: ManagementScope;
  queryClient?: QueryClient;
  renderAccounts?: AccountRowsRenderer;
  /** Rows inside another list: no own connect or refresh unless loading failed. */
  hideToolbar?: boolean;
  /** Replaces the default connect button, e.g. with the Add account dialog. */
  connectEntry?: ReactNode;
  connectOnly?: boolean;
  workspaceId?: string | undefined;
  addToWorkspace?: AddConnectionToWorkspace | undefined;
}) {
  const optionsCache = useCurrentGatewayModelAccountsCache();
  const [fallback] = useState(() => new QueryClient());
  const client = queryClient ?? optionsCache?.client ?? fallback;
  const bootstrapReadScope = `${managementScope}:${bootstrap.context}:${workspaceId ?? ""}`;
  const currentBootstrap = useRef({
    page: bootstrap.page,
    scope: bootstrapReadScope,
  });
  currentBootstrap.current = {
    page: bootstrap.page,
    scope: bootstrapReadScope,
  };
  const [acceptedBootstrap, setAcceptedBootstrap] = useState<{
    page: AccountsBootstrap["page"] | null;
    scope: string;
  }>(() => {
    const viewerScope = bootstrap.context.split(".")[0] ?? "";
    const scope =
      managementScope === "personal" ? `personal:${viewerScope}` : viewerScope;
    return {
      ...currentBootstrap.current,
      // A remounted view must reauthorize any existing interactive inventory.
      page: client.getQueryData(pageKey(scope, null)) ? null : bootstrap.page,
    };
  });
  const acknowledgeBootstrap = useCallback(
    (page: AccountsBootstrap["page"], scope: string) => {
      if (
        currentBootstrap.current.page === page &&
        currentBootstrap.current.scope === scope
      )
        setAcceptedBootstrap({ page, scope });
    },
    [],
  );
  const replacingBootstrap =
    acceptedBootstrap.page !== bootstrap.page ||
    acceptedBootstrap.scope !== bootstrapReadScope;
  const priorBootstrap = useRef(bootstrap.page);
  const removed = new Set(
    priorBootstrap.current.status === "ok" && bootstrap.page.status === "ok"
      ? priorBootstrap.current.value.accounts
          .filter(
            (old) =>
              bootstrap.page.status === "ok" &&
              !bootstrap.page.value.accounts.some(
                (row) => row.connectionId === old.connectionId,
              ),
          )
          .map((row) => row.connectionId)
      : [],
  );
  useEffect(() => {
    priorBootstrap.current = bootstrap.page;
  }, [bootstrap.page]);

  if (managementScope === "personal" && api === defaultManagementApi)
    return <p role="status">Personal account management is unavailable.</p>;
  return (
    <QueryClientProvider client={client}>
      <AccountLimitsReadContext.Provider
        value={{
          scope: accountLimitsScope(
            bootstrap.context,
            managementScope === "personal" ? undefined : workspaceId,
          ),
          context: bootstrap.context,
          workspaceId: managementScope === "personal" ? undefined : workspaceId,
          client,
          projections: new Map(
            bootstrap.page.status === "ok"
              ? bootstrap.page.value.accounts.flatMap((account) =>
                  account.limits
                    ? [
                        [
                          account.connectionId,
                          {
                            displayToken: account.limits.displayToken,
                            status: account.limits.status,
                            fetchedAt: account.limits.fetchedAt,
                          },
                        ] as const,
                      ]
                    : [],
                )
              : [],
          ),
          removed,
          replacingBootstrap,
          allowed: new Set(
            bootstrap.page.status === "ok"
              ? bootstrap.page.value.accounts.map((row) => row.connectionId)
              : [],
          ),
          denied:
            bootstrap.page.status !== "ok" &&
            bootstrap.page.status !== "unavailable",
        }}
      >
        <ConnectWorkspaceContext.Provider value={{ workspaceId }}>
          <Controls
            key={`${managementScope}:${bootstrap.context.split(".")[0]}`}
            bootstrap={bootstrap}
            bootstrapReadScope={bootstrapReadScope}
            replacingBootstrap={replacingBootstrap}
            acknowledgeBootstrap={acknowledgeBootstrap}
            api={api}
            managementScope={managementScope}
            renderAccounts={renderAccounts}
            hideToolbar={hideToolbar}
            connectEntry={connectEntry}
            connectOnly={connectOnly}
            workspaceId={workspaceId}
            addToWorkspace={
              managementScope === "personal" ? addToWorkspace : undefined
            }
          />
        </ConnectWorkspaceContext.Provider>
      </AccountLimitsReadContext.Provider>
    </QueryClientProvider>
  );
}

function Controls({
  bootstrap,
  bootstrapReadScope,
  replacingBootstrap,
  acknowledgeBootstrap,
  api,
  managementScope,
  renderAccounts,
  hideToolbar,
  connectEntry,
  connectOnly,
  workspaceId,
  addToWorkspace,
}: {
  bootstrap: AccountsBootstrap;
  bootstrapReadScope: string;
  replacingBootstrap: boolean;
  acknowledgeBootstrap(page: AccountsBootstrap["page"], scope: string): void;
  api: AccountGatewayManagementApi;
  managementScope: ManagementScope;
  renderAccounts: AccountRowsRenderer | undefined;
  hideToolbar: boolean;
  connectEntry: ReactNode;
  connectOnly: boolean;
  workspaceId: string | undefined;
  addToWorkspace: AddConnectionToWorkspace | undefined;
}) {
  // An embedded form follows the request its host holds, not the latest one.
  const target = useConnectTarget();
  const { context } = bootstrap;
  const contextScope = context.split(".")[0] ?? "";
  const personal = managementScope === "personal";
  const scope = personal ? `personal:${contextScope}` : contextScope;
  const storageKey = `rr-c3-account-operations:${scope}`;
  const connectWorkspacesKey = `${storageKey}:connect-workspaces`;
  const attachWorkspaceId = addToWorkspace ? workspaceId : undefined;
  const client = useQueryClient();
  const limitsScope = accountLimitsScope(
    context,
    personal ? undefined : workspaceId,
  );
  useEffect(
    () => () => {
      releaseAccountLimits(client, limitsScope);
    },
    [client, limitsScope],
  );
  const hydratedBootstrap = useRef(bootstrap.page);
  // Initial SSR data is already authorized and installed by useInfiniteQuery.
  // Only a replacement needs asynchronous eviction/publication; resetting the
  // accepted first page on mount can discard pagination started immediately.
  const hydratedScope = useRef<string | null>(
    replacingBootstrap ? null : bootstrapReadScope,
  );
  const removedByBootstrap = new Set(
    hydratedBootstrap.current.status === "ok" && bootstrap.page.status === "ok"
      ? hydratedBootstrap.current.value.accounts
          .filter(
            (old) =>
              bootstrap.page.status === "ok" &&
              !bootstrap.page.value.accounts.some(
                (row) => row.connectionId === old.connectionId,
              ),
          )
          .map((row) => row.connectionId)
      : [],
  );
  useEffect(() => {
    if (
      hydratedBootstrap.current === bootstrap.page &&
      hydratedScope.current === bootstrapReadScope
    )
      return;
    let current = true;
    void (async () => {
      await client.cancelQueries({
        queryKey: pageKey(scope, null),
        exact: true,
      });
      if (!current) return;
      // A connect-only view draws no rows. Dropping limits here would discard a
      // fresher observation that a list beside it already shows.
      if (!connectOnly) await removeAccountLimits(client, limitsScope);
      if (!current) return;
      const first = extractAccountLimits(client, limitsScope, bootstrap.page);
      hydratedBootstrap.current = bootstrap.page;
      hydratedScope.current = bootstrapReadScope;
      client.setQueryData<
        InfiniteData<AccountsResult<AccountsPage>, string | null>
      >(pageKey(scope, null), { pages: [first], pageParams: [null] });
      // Publish the authorized inventory before clearing the replacement fence.
      acknowledgeBootstrap(bootstrap.page, bootstrapReadScope);
    })();
    return () => {
      current = false;
    };
  }, [
    client,
    limitsScope,
    bootstrap.page,
    bootstrapReadScope,
    acknowledgeBootstrap,
    scope,
    connectOnly,
  ]);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        // A terminal receipt alone does not prove the displayed inventory has
        // crossed the reconnect fence. Unblock only after its authorized reread.
        if (
          key[0] !== "gateway-accounts" ||
          key[1] !== scope ||
          key[2] !== "page" ||
          event.type !== "updated" ||
          event.action.type !== "success"
        )
          return;
        for (const activity of client
          .getQueryCache()
          .findAll({ queryKey: ["account-lifecycle-activity", context] })) {
          const pending = activity.state.data as
            | { limitsReconnectNonce?: string }
            | undefined;
          if (!pending?.limitsReconnectNonce) continue;
          const result = client.getQueryData<
            AccountsResult<AccountOperationView>
          >(operationKey(scope, pending.limitsReconnectNonce));
          if (
            result &&
            (result.status !== "ok" ||
              ["applied", "rejected"].includes(result.value.state))
          )
            client.removeQueries({ queryKey: activity.queryKey, exact: true });
        }
      }),
    [client, context, scope],
  );
  async function fenceReconnect(nonce: string, connectionId: string) {
    client.setQueryData(["account-lifecycle-activity", context, connectionId], {
      pending: true,
      limitsReconnectNonce: nonce,
    });
    await removeAccountLimitsForConnection(client, connectionId);
  }
  const optionsCache = useCurrentGatewayModelAccountsCache();
  const [nonces, setNonces] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownActiveNonce, setOwnActiveNonce] = useState<string | null>(null);
  const activeNonce = target ? target.nonce : ownActiveNonce;
  const setActiveNonce = target ? target.setNonce : setOwnActiveNonce;
  const embedded = target !== null;
  // A completion arrives asynchronously; it may only act for the request
  // the form still follows, never for one the user has moved on from.
  const followedNonce = useRef(activeNonce);
  useEffect(() => {
    followedNonce.current = activeNonce;
  }, [activeNonce]);
  const [connectWorkspaces, setConnectWorkspaces] = useState<
    Record<string, string>
  >({});
  const [deviceHandoffs, setDeviceHandoffs] = useState<
    Record<string, DeviceAuthorization>
  >({});
  const [completionProviders, setCompletionProviders] = useState<
    Record<string, OAuthCompletionPresentation>
  >({});
  const lifecycleActivities = useAccountLifecycleActivities(client);
  const [completionHandoff, setCompletionHandoff] = useState<string | null>(
    null,
  );
  const completionHandoffRef = useRef<string | null>(null);
  const submitting = useRef(false);
  const page = useInfiniteQuery({
    queryKey: pageKey(scope, null),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      readAccountResult(api.listGatewayAccounts(context, pageParam)).then(
        (result) => {
          if (signal.aborted)
            throw new Error("Account inventory read canceled");
          return extractAccountLimits(client, limitsScope, result);
        },
      ),
    initialData: () => ({
      pages: [extractAccountLimits(client, limitsScope, bootstrap.page)],
      pageParams: [null],
    }),
    getNextPageParam: (result) =>
      result.status === "ok" ? result.value.nextCursor : null,
    enabled: Boolean(context),
    staleTime: 15000,
    retry: false,
  });
  useEffect(() => {
    try {
      const saved = savedNonces(storageKey);
      setNonces(saved);
      // A standalone view resumes the latest request; an embedded one keeps
      // its host's request while it is still saved.
      setActiveNonce((active) =>
        embedded
          ? active && saved.includes(active)
            ? active
            : null
          : (saved.at(-1) ?? null),
      );
      try {
        setConnectWorkspaces(
          savedConnectWorkspaces(connectWorkspacesKey, saved),
        );
      } catch {
        /* An unreadable record only skips automatic workspace attach. */
      }
      setReady(true);
    } catch {
      setMessage(
        "Connection status is unavailable in this tab. Enable session storage before starting a connection.",
      );
    }
  }, [storageKey, connectWorkspacesKey, embedded, setActiveNonce]);
  useEffect(() => {
    // The Add dialog and the list beside it are separate views of the same
    // owner. A connection saved or dismissed in one shows its status in both.
    const sync = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== storageKey) return;
      try {
        const saved = savedNonces(storageKey);
        setNonces(saved);
        // A request dismissed in the other view no longer holds this one.
        setActiveNonce((active) =>
          active && !saved.includes(active) ? null : active,
        );
        setConnectWorkspaces(
          savedConnectWorkspaces(connectWorkspacesKey, saved),
        );
      } catch {
        /* Keep the statuses already shown. */
      }
    };
    window.addEventListener(operationsChangedEvent, sync);
    return () => window.removeEventListener(operationsChangedEvent, sync);
  }, [storageKey, connectWorkspacesKey, setActiveNonce]);
  const refresh = useCallback(async () => {
    // A personal connection, including one made in the Add dialog, also changes
    // the owner's sources, access summaries, the workspace overview and the
    // workspace's own list in the same view; that refresh covers this list and
    // the viewer's model options too.
    if (personal) return refreshPersonalAccountViews(client, context);
    // Refresh every already displayed page with exact keys; no unrelated dashboard cache.
    await Promise.all(
      client
        .getQueryCache()
        .findAll({ queryKey: ["gateway-accounts", scope, "page"] })
        .map((query) =>
          client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
        ),
    );
    await optionsCache?.refresh();
  }, [client, scope, personal, context, optionsCache]);
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
  function reserveNonce(connectWorkspaceId?: string): string | null {
    if (!ready || nonces.length >= 8) {
      setMessage(
        ready && embedded
          ? "Too many recent connection requests in this tab. Hide old results in Connections, then try again."
          : "Check recent connections or hide old results before starting another.",
      );
      return null;
    }
    const nonce = crypto.randomUUID();
    try {
      const next = [...savedNonces(storageKey), nonce];
      if (next.length > 8) throw new Error();
      if (connectWorkspaceId) {
        let records: Record<string, string> = {};
        try {
          records = savedConnectWorkspaces(connectWorkspacesKey, next);
        } catch {
          /* Replace an unreadable record; it only names connect workspaces. */
        }
        records[nonce] = connectWorkspaceId;
        sessionStorage.setItem(connectWorkspacesKey, JSON.stringify(records));
        setConnectWorkspaces(records);
      }
      // Persist BEFORE request entry: a lost response/reload preserves the operation identity.
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setNonces(next);
      setActiveNonce(nonce);
      setMessage("");
      announceOperationsChanged(storageKey);
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
      if (activeNonce === nonce) setActiveNonce(null);
      announceOperationsChanged(storageKey);
      setDeviceHandoffs((previous) => {
        const next = { ...previous };
        delete next[nonce];
        return next;
      });
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
      result.status === "ok" ? "" : statusText(result.status, managementScope),
    );
    await refresh();
  }
  async function beginOAuth(
    intent: OAuthFormIntent,
    existingNonce?: string,
    native?: NativeConnectionSubmission,
  ) {
    if (submitting.current) return;
    const method = native
      ? native.interaction === "browser"
        ? "browser"
        : native.interaction === "device"
          ? "device_code"
          : undefined
      : (intent.method ?? "device_code");
    let tab: Window | null = null;
    let nonce: string | null;
    try {
      if (method === "browser") {
        tab = window.open("about:blank", "_blank");
        if (!tab) throw new Error();
        tab.opener = null;
        const referrer = tab.document.createElement("meta");
        referrer.name = "referrer";
        referrer.content = "no-referrer";
        tab.document.head.append(referrer);
      }
      nonce = existingNonce
        ? nonces.includes(existingNonce)
          ? existingNonce
          : null
        : reserveNonce(
            "connectionId" in intent ? undefined : attachWorkspaceId,
          );
    } catch {
      tab?.close();
      setMessage(
        "Could not open a safe authorization tab. Allow popups and try again. Nothing was submitted.",
      );
      return;
    }
    if (!nonce) {
      tab?.close();
      return;
    }
    if (data?.status === "ok") {
      const profileId =
        "profileId" in intent
          ? intent.profileId
          : data.value.accounts.find(
              (account) => account.connectionId === intent.connectionId,
            )?.profileId;
      const profile = data.value.profiles.find(
        (profile) => profile.id === profileId,
      );
      const presentation = oauthCompletionPresentation(profile);
      if (presentation)
        setCompletionProviders((previous) => ({
          ...previous,
          [nonce!]: presentation,
        }));
    }
    submitting.current = true;
    setBusy(true);
    let navigated = false;
    let completionReady = false;
    try {
      if ("connectionId" in intent)
        await fenceReconnect(nonce, intent.connectionId);
      // Direct ingress: neither the Begin response nor its temporary URL enters
      // a query/mutation cache, component state, storage or a readback request.
      const fresh = native
        ? api.beginGatewayNativeConnection
          ? await api.beginGatewayNativeConnection(
              context,
              { ...native.intent, nonce },
              native.inputFields,
            )
          : { status: "unavailable" as const }
        : await api.beginGatewayOAuth(context, {
            ...intent,
            ...(method ? { method } : {}),
            nonce,
          });
      const safe: AccountsResult<AccountOperationView> =
        fresh.status === "ok"
          ? fresh.value.operation.nonce === nonce
            ? {
                status: "ok",
                value: {
                  ...fresh.value.operation,
                  ...(method ? { oauthMethod: method } : {}),
                },
              }
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
        tab &&
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
      } else tab?.close();
      if (
        fresh.status === "ok" &&
        method === "device_code" &&
        fresh.value.operation.nonce === nonce &&
        fresh.value.operation.state === "pending" &&
        fresh.value.deviceAuthorization &&
        validAuthorizationURL(fresh.value.deviceAuthorization.verificationURL)
      ) {
        // Only the fresh, user-visible code is ephemeral; never cache the provider handoff.
        const { userCode, verificationURL, expiresAt, intervalSeconds } =
          fresh.value.deviceAuthorization;
        setDeviceHandoffs((previous) => ({
          ...previous,
          [nonce!]: { userCode, verificationURL, expiresAt, intervalSeconds },
        }));
      }
      if (completionReady) offerCompletionHandoff(nonce);
      await accept(nonce, safe);
    } catch {
      if (!navigated) tab?.close();
      await accept(nonce, {
        status: "ok",
        value: { nonce, state: "unknown", cleanup: "unresolved" },
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function beginNative(
    submission: NativeConnectionSubmission,
    existingNonce?: string,
  ) {
    const { intent } = submission;
    return beginOAuth(
      intent.existing
        ? { ...intent.existing }
        : {
            profileId: intent.connection.profileId,
            ...(intent.label ? { label: intent.label } : {}),
          },
      existingNonce,
      submission,
    );
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
    const nonce = reserveNonce(
      intent.kind === "connect" ? attachWorkspaceId : undefined,
    );
    if (!nonce) return;
    submitting.current = true;
    setBusy(true);
    try {
      if (intent.kind === "reconnect" && intent.connectionId)
        await fenceReconnect(nonce, intent.connectionId);
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
    // The request may have reached the server; only a reread can tell.
    onError: () =>
      setMessage(
        "Could not confirm adding it to this workspace. Refresh connections to check.",
      ),
  });
  const visiblePages =
    hydratedBootstrap.current !== bootstrap.page
      ? [bootstrap.page]
      : page.data.pages;
  const loaded = visiblePages.filter((result) => result.status === "ok");
  const failure = visiblePages.find((result) => result.status !== "ok");
  const data = failure
    ? failure
    : loaded.length
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
          ? removedFromWorkspaceText(result.value.remoteFenceDelivery)
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
    page.isError ||
    Boolean(failure) ||
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
          ? "A workspace change is being confirmed. Try again later."
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
        !account.connection?.nativeMethods &&
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
        !account.connection?.nativeMethods &&
        account.profileId !== "anthropic-claude-oauth-messages-v1" &&
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
            submit={submit}
            managementScope={managementScope}
          />
        ) : null}
        {account.connection?.nativeMethods &&
        account.state !== "disabled" &&
        account.state !== "tombstoned" &&
        data.value.profiles.find((p) => p.id === account.profileId)
          ?.canReconnect ? (
          <NativeConnectionForm
            profile={
              data.value.profiles.find((p) => p.id === account.profileId)!
            }
            account={account}
            disabled={sourceBusy || account.canManage !== true}
            disabledReason={manageReason}
            begin={beginNative}
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
      </>
    );
  }
  const enrollmentProfiles =
    data?.status === "ok"
      ? data.value.profiles.filter(
          (p) =>
            centrallyEnrollAllowed(p) &&
            (p.provider !== "nvidia" ||
              (p.id === "nvidia-build-chat-apikey-v1" &&
                p.availability === "enabled" &&
                p.connection?.provider === "nvidia")) &&
            (!target || connectsInProviderDialog(p, target.provider)),
        )
      : [];
  const enrollmentAccounts = data?.status === "ok" ? data.value.accounts : [];
  const fullToolbar = !connectOnly && !hideToolbar;
  // Refresh stays available whenever the list could not load.
  const showToolbar = fullToolbar || page.isError || Boolean(failure);
  return (
    <div className="space-y-4">
      {connectOnly && !activeNonce && enrollmentProfiles.length > 0 ? (
        <ConnectionForm
          key={target?.provider}
          profiles={enrollmentProfiles}
          accounts={enrollmentAccounts}
          disabled={disabled}
          managementScope={managementScope}
          begin={beginOAuth}
          beginNative={beginNative}
          submit={submit}
        />
      ) : embedded && !activeNonce && data?.status === "ok" ? (
        <p role="status" className="text-sm text-slate-400">
          This provider cannot be connected here yet.
        </p>
      ) : null}
      {showToolbar ? (
        <div className="flex flex-wrap gap-3">
          {!fullToolbar ? null : connectEntry !== undefined ? (
            connectEntry
          ) : enrollmentProfiles.some(
              (p) =>
                p.connection?.nativeMethods ||
                p.authKind === "api_key" ||
                p.authKind === "oauth",
            ) ? (
            <ConnectAccountDialog
              profiles={enrollmentProfiles.filter(
                (p) =>
                  p.connection?.nativeMethods ||
                  p.authKind === "api_key" ||
                  p.authKind === "oauth",
              )}
              accounts={enrollmentAccounts}
              disabled={disabled}
              managementScope={managementScope}
              addsToWorkspace={Boolean(addToWorkspace)}
              begin={beginOAuth}
              beginNative={beginNative}
              submit={submit}
            />
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
      ) : null}
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
      {connectOnly && data?.status !== "ok" ? (
        <p role="status" className="text-sm text-slate-400">
          {statusText(data?.status ?? "unavailable", managementScope)}
        </p>
      ) : null}
      {nonces.length ? (
        <div className="space-y-2 border-t border-cyan-200/10 pt-4">
          {!connectOnly ? (
            <h4 className="text-sm font-semibold text-cyan-50">
              Connection status
            </h4>
          ) : null}
          {!connectOnly ? (
            <p className="text-xs text-slate-400">
              Recent requests update automatically. You can close this view and
              return to the same request.
            </p>
          ) : null}
          {nonces
            .filter((nonce) => !connectOnly || nonce === activeNonce)
            .map((nonce) => (
              <OperationReadback
                key={nonce}
                context={context}
                scope={scope}
                nonce={nonce}
                dismiss={() => {
                  dismiss(nonce);
                  if (activeNonce === nonce) setActiveNonce(null);
                }}
                refresh={refresh}
                listFailed={page.isError || Boolean(failure)}
                deviceAuthorization={deviceHandoffs[nonce]}
                completionProvider={completionProviders[nonce]}
                beginContinuation={(intent) => beginOAuth(intent, nonce)}
                nativeContinuation={(submission) =>
                  beginNative(submission, nonce)
                }
                profiles={data?.status === "ok" ? data.value.profiles : []}
                inline={connectOnly}
                cancel={
                  // Leaves a waiting sign-in as a receipt in Connections.
                  embedded ? () => setActiveNonce(null) : undefined
                }
                startAnother={() => {
                  // Embedded: a declined request leaves nothing to keep. Any
                  // other result stays a receipt in Connections, with its retry.
                  const result = client.getQueryData<
                    AccountsResult<AccountOperationView>
                  >(operationKey(scope, nonce));
                  if (
                    embedded &&
                    result?.status === "ok" &&
                    result.value.state === "rejected"
                  )
                    dismiss(nonce);
                  else setActiveNonce(null);
                }}
                autoOpenCompletion={completionHandoff === nonce}
                consumeCompletionHandoff={() => consumeCompletionHandoff(nonce)}
                oauthEnabled={
                  data?.status === "ok" &&
                  data.value.profiles.some(
                    (p) =>
                      p.connection?.nativeMethods || p.authKind === "oauth",
                  )
                }
                api={api}
                managementScope={managementScope}
                addToWorkspace={
                  attachWorkspaceId &&
                  connectWorkspaces[nonce] === attachWorkspaceId
                    ? addToWorkspace
                    : undefined
                }
                onConnected={
                  target
                    ? (bindingId) => {
                        // An older request stays a receipt in Connections.
                        if (followedNonce.current !== nonce) return;
                        dismiss(nonce);
                        target.onConnected(bindingId);
                      }
                    : undefined
                }
              />
            ))}
        </div>
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
              <div className="min-w-0">
                <AccountIdentity
                  label={account.label}
                  profileLabel={account.profileLabel}
                  provider={account.provider}
                  authKind={account.authKind}
                  nativeCredential={account.nativeCredential}
                  connection={account.connection}
                  metadata={
                    lifecycleActivities.has(account.connectionId)
                      ? { status: "unknown", displayToken: "restricted" }
                      : account.metadata
                  }
                />
                <AccountLimitsLine
                  scope={limitsScope}
                  context={context}
                  connectionId={account.connectionId}
                  client={client}
                  workspaceId={personal ? undefined : workspaceId}
                  expectedDisplayToken={
                    bootstrap.page.status === "ok"
                      ? bootstrap.page.value.accounts.find(
                          (row) => row.connectionId === account.connectionId,
                        )?.limits?.displayToken
                      : undefined
                  }
                  expectedFetchedAt={
                    bootstrap.page.status === "ok"
                      ? bootstrap.page.value.accounts.find(
                          (row) => row.connectionId === account.connectionId,
                        )?.limits?.fetchedAt
                      : undefined
                  }
                  expectedStatus={
                    bootstrap.page.status === "ok"
                      ? bootstrap.page.value.accounts.find(
                          (row) => row.connectionId === account.connectionId,
                        )?.limits?.status
                      : undefined
                  }
                  blocked={
                    (bootstrap.page.status !== "ok" &&
                      bootstrap.page.status !== "unavailable") ||
                    removedByBootstrap.has(account.connectionId) ||
                    lifecycleActivities.has(account.connectionId) ||
                    account.state === "tombstoned"
                  }
                />
                <div className="mt-2 text-sm text-slate-300">
                  <AccountStatusLine
                    {...connectionRowStatus({
                      account,
                      // A failed reread keeps the previous rows on screen.
                      refreshFailed: page.isError,
                      localAction: lifecycleActivities.get(
                        account.connectionId,
                      ),
                      pendingChange: account.binding?.fencePending,
                    })}
                  />
                  {personal ? null : (
                    <WorkspaceUseLine
                      use={bindingWorkspaceUse(account.binding)}
                    />
                  )}
                </div>
                {account.state === "quarantined" ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Connection could not be confirmed. Use a supported reconnect
                    action if available, or check the original request below.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {!personal &&
                account.binding?.state === "active" &&
                !account.binding.fencePending ? (
                  <ChooseForReviewsLink workspaceId={workspaceId} />
                ) : null}
                {renderActions(account)}
                {/* A host list (renderAccounts) owns removal from the
                    workspace for its rows; only this own list offers it. */}
                {!personal && account.binding?.state === "active" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={accountMenuItemClass}
                    disabled={disabled}
                    title={
                      disabled
                        ? "Wait for the current refresh to finish."
                        : undefined
                    }
                    onClick={() => detachMutation.mutate(account)}
                  >
                    {accountsCopy.detach}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {!connectOnly && page.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          disabled={page.isFetching || replacingBootstrap}
          onClick={() => {
            if (!replacingBootstrap) void page.fetchNextPage();
          }}
        >
          Load more connection details
        </Button>
      ) : null}
    </div>
  );
}

/** One provider-first entry point; operation progress stays with the controller. */
function ConnectAccountDialog({
  profiles,
  accounts,
  disabled,
  managementScope,
  addsToWorkspace = false,
  begin,
  beginNative,
  submit,
}: Parameters<typeof ConnectionForm>[0] & {
  addsToWorkspace?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
      >
        <Plus aria-hidden="true" className="size-4" />
        {managementScope === "personal"
          ? accountsCopy.connect
          : accountsCopy.add}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.CloseButton label="Close connect account" />
          <Dialog.Title>Connect a provider</Dialog.Title>
          <Dialog.Description>
            Choose a provider, then connect its account or credential.
            {managementScope === "personal"
              ? addsToWorkspace
                ? " This connection belongs to you. It is added to this workspace if you are a workspace owner or admin."
                : " This connection belongs to you. You choose which workspaces can use it."
              : " This connection belongs to this workspace."}
          </Dialog.Description>
          {open ? (
            <ConnectionForm
              profiles={profiles}
              accounts={accounts}
              disabled={disabled}
              managementScope={managementScope}
              begin={(intent) => {
                setOpen(false);
                return begin(intent);
              }}
              beginNative={(submission) => {
                setOpen(false);
                return beginNative(submission);
              }}
              submit={(intent, credential) => {
                setOpen(false);
                return submit(intent, credential);
              }}
            />
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConnectionForm({
  profiles,
  accounts,
  disabled,
  managementScope,
  begin,
  beginNative,
  submit,
}: {
  profiles: AccountProfileView[];
  accounts: AccountView[];
  disabled: boolean;
  managementScope: ManagementScope;
  begin(intent: OAuthFormIntent): Promise<void>;
  beginNative(submission: NativeConnectionSubmission): Promise<void>;
  submit(
    intent: Omit<AccountIntent, "nonce">,
    credential?: string,
  ): Promise<void>;
}) {
  const ordered = [...profiles].sort(
    (a, b) => Number(b.authKind === "oauth") - Number(a.authKind === "oauth"),
  );
  const setup = useContext(ConnectWorkspaceContext);
  const [profileId, setProfileId] = useState(ordered[0]?.id ?? "");
  const profile = profiles.find((row) => row.id === profileId);
  const formContainer = useRef<HTMLDivElement>(null);
  const target = useConnectTarget();
  // The host already chose the provider; a second choice would only repeat it.
  const chooseProfile = !target || profiles.length > 1;
  // Only when the host has none: an active one of the user's own is not in
  // this workspace yet, and adding it beats a duplicate sign-in.
  const existing = target?.empty
    ? accounts.find(
        (account) =>
          account.state === "active" &&
          profiles.some((row) => row.id === account.profileId),
      )
    : undefined;
  return (
    <div ref={formContainer} className="space-y-4">
      {existing ? (
        <p className="text-sm text-slate-300">
          You already have {existing.label}.{" "}
          {setup.workspaceId ? (
            <a
              className="font-semibold text-cyan-200 underline"
              href={`${dashboardPath({ section: "setup", workspace: setup.workspaceId })}#your-accounts`}
            >
              Add it to this workspace in Connections
            </a>
          ) : (
            "Add it to this workspace in Connections"
          )}
          , or connect another one below.
        </p>
      ) : null}
      {!chooseProfile ? null : (
        <SelectField
          name="connectionProvider"
          label={
            <span className="flex items-center gap-2">
              <AccountProviderLogo
                connection={profile?.connection}
                provider={profile?.provider}
              />
              Provider
            </span>
          }
          value={profileId}
          onValueChange={(id) => {
            const credential =
              formContainer.current?.querySelector<HTMLInputElement>(
                'input[name="credential"]',
              );
            if (credential) credential.value = "";
            setProfileId(id);
          }}
          options={ordered.map((row) => ({
            value: row.id,
            label: row.connection?.nativeMethods
              ? (row.connection.providerLabel ?? row.label)
              : setupProviderForGatewayProfile(row)
                ? getSetupProvider(setupProviderForGatewayProfile(row)!).label
                : row.label,
            icon: (
              <AccountProviderLogo
                connection={row.connection}
                provider={row.provider}
              />
            ),
            description:
              (row.connection?.nativeMethods
                ? [row.connection.planLabel, row.connection.regionLabel]
                    .filter(Boolean)
                    .join(" · ")
                : row.connection?.planLabel) ??
              (row.authKind === "oauth" ? "Sign in" : "API key"),
          }))}
        />
      )}
      {profile?.connection?.nativeMethods ? (
        <NativeConnectionForm
          key={profile.id}
          profile={profile}
          accounts={accounts}
          inline
          disabled={disabled}
          begin={beginNative}
        />
      ) : profile?.authKind === "oauth" ? (
        <OAuthForm
          key={profile.id}
          inline
          accounts={accounts}
          profiles={[profile]}
          disabled={disabled}
          managementScope={managementScope}
          begin={begin}
          submit={submit}
        />
      ) : profile ? (
        <AccountForm
          inline
          accounts={accounts}
          profiles={[profile]}
          disabled={disabled}
          managementScope={managementScope}
          submit={submit}
        />
      ) : null}
    </div>
  );
}

function OperationReadback({
  context,
  scope,
  nonce,
  listFailed,
  deviceAuthorization,
  completionProvider,
  beginContinuation,
  nativeContinuation,
  profiles,
  inline = false,
  startAnother,
  cancel,
  dismiss,
  refresh,
  oauthEnabled,
  autoOpenCompletion,
  consumeCompletionHandoff,
  api,
  managementScope,
  addToWorkspace,
  onConnected,
}: {
  context: string;
  scope: string;
  nonce: string;
  listFailed: boolean;
  startAnother(): void;
  /** An embedded form may leave a waiting request and start over. */
  cancel?: (() => void) | undefined;
  deviceAuthorization?: DeviceAuthorization | undefined;
  completionProvider?: OAuthCompletionPresentation | undefined;
  beginContinuation(intent: OAuthFormIntent): Promise<void>;
  nativeContinuation(submission: NativeConnectionSubmission): Promise<void>;
  profiles: readonly AccountProfileView[];
  inline?: boolean;
  dismiss(): void;
  refresh(): Promise<void>;
  oauthEnabled: boolean;
  autoOpenCompletion: boolean;
  consumeCompletionHandoff(): void;
  api: AccountGatewayManagementApi;
  managementScope: ManagementScope;
  addToWorkspace?: AddConnectionToWorkspace | undefined;
  /** Once the new connection is added to the workspace it was made from. */
  onConnected?: ((bindingId: string) => void) | undefined;
}) {
  const client = useQueryClient();
  const [pollUntil] = useState(() => Date.now() + 15 * 60000);
  const promoted = useRef(false);
  const [completionOffered, setCompletionOffered] = useState(false);
  const [completionSpent, setCompletionSpent] = useState(false);
  const [keyContinuationSpent, setKeyContinuationSpent] = useState(false);
  const keyContinuationEntered = useRef(false);
  const keyContinuationInFlight = useRef(false);
  const keyContinuationGeneration = useRef(0);
  const keyStatusCheckInFlight = useRef(false);
  const originalKeyResume = useRef<AccountOperationView["resume"]>(undefined);
  const [keyContinuationBusy, setKeyContinuationBusy] = useState(false);
  const [keySubmitFailure, setKeySubmitFailure] = useState("");
  const operation = useQuery({
    queryKey: operationKey(scope, nonce),
    queryFn: () => {
      const known = client.getQueryData<AccountsResult<AccountOperationView>>(
        operationKey(scope, nonce),
      );
      return readAccountResult(
        known?.status === "ok" &&
          known.value.oauthMethod === "device_code" &&
          known.value.state === "pending" &&
          (known.value.native
            ? api.continueGatewayNativeConnection
            : api.pollGatewayOAuth)
          ? known.value.native
            ? api.continueGatewayNativeConnection!(context, nonce)
            : api.pollGatewayOAuth!(context, nonce)
          : api.readGatewayOperation(context, nonce),
      );
    },
    staleTime: 3000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) =>
      query.state.data?.status === "ok" &&
      query.state.data.value.state === "pending" &&
      Date.now() <
        (deviceAuthorization
          ? Date.parse(deviceAuthorization.expiresAt)
          : pollUntil)
        ? Math.max(3000, (deviceAuthorization?.intervalSeconds ?? 3) * 1000)
        : false,
  });
  const data = operation.data;
  const state = data?.status === "ok" ? data.value.state : "unresolved";
  useEffect(() => {
    if (state === "applied" && !promoted.current) {
      promoted.current = true;
      void refresh();
    }
  }, [state, refresh]); // refresh exact account pages after promotion
  const resume =
    managementScope === "personal" && data?.status === "ok"
      ? data.value.resume
      : undefined;
  const oauthResume =
    resume &&
    !resume.nativeConnection &&
    data?.status === "ok" &&
    data.value.completion &&
    data.value.completion.inputKind !== "none"
      ? resume
      : undefined;
  const keyResume =
    oauthResume || resume?.nativeConnection ? undefined : resume;
  const nativeResumeProfile = resume?.nativeConnection
    ? profiles.find(
        (profile) => profile.id === resume.nativeConnection!.profileId,
      )
    : undefined;
  async function continueOAuth() {
    if (keyContinuationEntered.current || !oauthResume || state !== "pending")
      return;
    const selectedResume = { ...oauthResume };
    keyContinuationEntered.current = true;
    keyContinuationInFlight.current = true;
    keyContinuationGeneration.current++;
    originalKeyResume.current = selectedResume;
    setKeyContinuationSpent(true);
    setKeyContinuationBusy(true);
    try {
      await client.cancelQueries({
        queryKey: operationKey(scope, nonce),
        exact: true,
      });
      await beginContinuation({
        connectionId: selectedResume.connectionId,
        gatewayRevision: selectedResume.gatewayRevision,
        mirrorRevision: selectedResume.mirrorRevision,
        method: "browser",
      });
    } finally {
      keyContinuationInFlight.current = false;
      setKeyContinuationBusy(false);
    }
  }
  async function continueKeyUpdate(credential: string) {
    if (keyContinuationEntered.current || !keyResume || state !== "pending")
      return;
    const selectedResume = { ...keyResume };
    const unconfirmedText = selectedResume.credentialImportMethod
      ? "The credential import was not confirmed. Use Check status to see the current state before submitting it again."
      : keyUnconfirmedText;
    keyContinuationEntered.current = true;
    keyContinuationInFlight.current = true;
    keyContinuationGeneration.current++;
    originalKeyResume.current = selectedResume;
    setKeySubmitFailure("");
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
        else
          setKeySubmitFailure(
            returned.status === "ok"
              ? unconfirmedText
              : `${selectedResume.credentialImportMethod ? "The credential import" : "The key"} was not saved. ${statusText(returned.status, managementScope)}`,
          );
      } catch {
        // Any uncertain submission is readback-only under this original nonce.
        setKeySubmitFailure(unconfirmedText);
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
      if (fresh?.status === "ok" && fresh.value.state === "applied")
        await refresh();
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
        resume.mirrorRevision === original.mirrorRevision &&
        resume.credentialImportMethod === original.credentialImportMethod
      ) {
        keyContinuationEntered.current = false;
        setKeyContinuationSpent(false);
      }
    } finally {
      keyStatusCheckInFlight.current = false;
    }
  }
  const savedCompletion =
    data?.status === "ok" ? data.value.completion : undefined;
  const completion = savedCompletion
    ? savedCompletion.inputKind === "none"
      ? undefined
      : {
          label: savedCompletion.providerLabel,
          providerId: savedCompletion.providerId,
          inputKind: savedCompletion.inputKind,
        }
    : completionProvider;
  const terminal = state === "applied" || state === "rejected";
  const attachConnected =
    addToWorkspace && state === "applied" ? addToWorkspace : undefined;
  return (
    <div className="space-y-4 text-sm text-slate-300">
      <div role="status" className="space-y-3">
        {data?.status === "ok" && data.value.account ? (
          <AccountIdentity
            label={data.value.account.label}
            profileLabel={data.value.account.profileLabel}
            provider={data.value.account.provider}
            authKind={data.value.account.authKind}
            nativeCredential={data.value.account.nativeCredential}
            connection={data.value.account.connection}
            metadata={data.value.account.metadata}
          />
        ) : data?.status === "ok" && data.value.oauthMethod ? (
          <div className="flex items-center gap-3 font-medium text-cyan-50">
            <AccountProviderLogo providerId={completion?.providerId} />
            <span>{completion?.label ?? "Provider"} sign-in</span>
          </div>
        ) : (
          <p className="font-medium text-cyan-50">Account connection</p>
        )}
        <div className={state === "applied" ? "text-emerald-300" : undefined}>
          <AccountStatusLine
            kind={
              state === "applied"
                ? "ready"
                : state === "pending"
                  ? "confirming"
                  : state === "rejected"
                    ? "attention"
                    : "unknown"
            }
            text={operationStateText(state)}
          />
        </div>
        {state === "applied" ? (
          <p className="text-sm text-slate-400">
            {data?.status === "ok" && data.value.oauthMethod
              ? "Sign-in complete."
              : "Request completed."}{" "}
            {attachConnected
              ? null
              : managementScope === "personal"
                ? "Organization access can be granted separately via Access."
                : "Availability for reviews depends on workspace access and model selection."}
          </p>
        ) : state === "pending" ? (
          <p className="text-sm text-slate-400">
            Waiting for provider confirmation. This page checks automatically;
            you can close it and return to this request.
          </p>
        ) : state === "unknown" ? (
          <p className="text-sm text-slate-400">
            The result is not confirmed yet. Check this request before starting
            again.
          </p>
        ) : null}
      </div>
      {attachConnected ? (
        <ConnectWorkspaceAttach
          nonce={nonce}
          addToWorkspace={attachConnected}
          refresh={refresh}
          onConnected={onConnected}
        />
      ) : null}
      {state === "pending" &&
      data?.status === "ok" &&
      data.value.oauthMethod === "device_code" ? (
        <DeviceCodeHandoff
          authorization={deviceAuthorization}
          providerLabel={
            data.value.native
              ? (profiles.find(
                  (profile) =>
                    profile.id === data.value.native!.connection.profileId,
                )?.connection?.providerLabel ?? "your provider")
              : "OpenAI"
          }
        />
      ) : null}
      {operation.isError ? (
        <p role="status" className="text-sm text-slate-400">
          Status could not be refreshed. The last confirmed result is shown.
        </p>
      ) : null}
      {!terminal || listFailed || operation.isError ? (
        <Button
          variant="outline"
          size="sm"
          disabled={operation.isFetching || keyContinuationBusy}
          onClick={() => void checkStatus()}
        >
          {state === "applied" ? "Refresh account details" : "Check status"}
        </Button>
      ) : null}
      {keySubmitFailure ? (
        <p role="alert" className="text-sm text-amber-200">
          {keySubmitFailure}
        </p>
      ) : null}
      {state === "pending" && oauthResume && !keyContinuationSpent ? (
        <Button
          type="button"
          disabled={keyContinuationBusy}
          onClick={() => void continueOAuth()}
        >
          Continue sign-in
        </Button>
      ) : null}
      {state === "pending" && keyResume && !keyContinuationSpent ? (
        <KeyUpdateContinuation
          submit={continueKeyUpdate}
          method={keyResume.credentialImportMethod}
        />
      ) : null}
      {state === "pending" &&
      resume?.nativeConnection &&
      nativeResumeProfile ? (
        <NativeConnectionForm
          key={`${nonce}:${resume.nativeConnection.methodId}`}
          profile={nativeResumeProfile}
          inline
          selection={resume.nativeConnection}
          account={{
            connectionId: resume.connectionId,
            gatewayRevision: resume.gatewayRevision,
            mirrorRevision: resume.mirrorRevision,
            label: nativeResumeProfile.label,
          }}
          disabled={keyContinuationBusy || operation.isFetching}
          begin={nativeContinuation}
        />
      ) : null}
      {state === "pending" &&
      !keyResume &&
      !resume?.nativeConnection &&
      !(
        data?.status === "ok" &&
        data.value.native?.method.interaction.kind === "browser" &&
        data.value.native.method.interaction.callbackMode === "automatic"
      ) &&
      (!oauthResume || keyContinuationSpent) &&
      !(data?.status === "ok" && data.value.oauthMethod === "device_code") &&
      (completion ||
        (data?.status === "ok" && data.value.oauthMethod === "browser") ||
        autoOpenCompletion ||
        completionOffered) &&
      (oauthEnabled ||
        (data?.status === "ok" && Boolean(data.value.native)) ||
        autoOpenCompletion ||
        completionOffered) ? (
        <OAuthCompletionForm
          inline={inline}
          completeOAuth={api.completeGatewayOAuth}
          completeNative={
            data?.status === "ok" && data.value.native
              ? api.continueGatewayNativeConnection
              : undefined
          }
          provider={completion}
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
      {inline && terminal ? (
        <Button variant="outline" size="sm" onClick={startAnother}>
          Add another account
        </Button>
      ) : null}
      {cancel && !terminal ? (
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel sign-in
        </Button>
      ) : null}
      {(terminal && !inline) || state === "unknown" ? (
        <Button variant="outline" size="sm" onClick={dismiss}>
          {state === "unknown" ? "Hide" : "Dismiss"}
        </Button>
      ) : null}
    </div>
  );
}

const connectAttachText: Record<
  Extract<ConnectWorkspaceAttachment, { status: "not_attached" }>["reason"],
  string
> = {
  not_permitted:
    "Not added to this workspace. Only workspace owners and admins can add their own connections. It stays in your connections.",
  not_connected:
    "Not added to this workspace yet. Check the connection status, then try again.",
  removed:
    "Removed from this workspace after it was added. Use Access in your connections to add it again.",
  unavailable:
    "Could not add it to this workspace. Try again, or use Access in your connections.",
};

/** Runs once per applied connect. The server action is idempotent per nonce
 * and workspace, so a remount only reads the original result back. */
function ConnectWorkspaceAttach({
  nonce,
  addToWorkspace,
  refresh,
  onConnected,
}: {
  nonce: string;
  addToWorkspace: AddConnectionToWorkspace;
  refresh(): Promise<void>;
  onConnected?: ((bindingId: string) => void) | undefined;
}) {
  const attach = useMutation({
    mutationKey: ["connect-workspace-attach", nonce] as const,
    mutationFn: () => addToWorkspace(nonce),
    onSuccess: (result) => {
      if (result.status !== "ok" || result.value.status !== "attached") return;
      const { bindingId } = result.value;
      void refresh().finally(() => onConnected?.(bindingId));
    },
    retry: false,
    gcTime: 0,
  });
  const { mutate } = attach;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);
  const result = attach.data;
  const text = attach.isError
    ? connectAttachText.unavailable
    : !result
      ? "Adding to this workspace…"
      : result.status !== "ok"
        ? statusText(result.status, "personal")
        : result.value.status === "attached"
          ? onConnected
            ? "Added to this workspace."
            : "Added to this workspace. Choose it in Review providers to use it for reviews."
          : connectAttachText[result.value.reason];
  const retryable =
    !attach.isPending &&
    (attach.isError ||
      (result !== undefined &&
        (result.status === "unavailable" ||
          (result.status === "ok" &&
            result.value.status === "not_attached" &&
            (result.value.reason === "unavailable" ||
              result.value.reason === "not_connected")))));
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm text-slate-300">
        {text}
      </p>
      {retryable ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => mutate()}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function DeviceCodeHandoff({
  authorization,
  providerLabel,
}: {
  authorization: DeviceAuthorization | undefined;
  providerLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(
    () => !!authorization && Date.now() >= Date.parse(authorization.expiresAt),
  );
  useEffect(() => {
    if (!authorization) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(authorization.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [authorization]);
  if (expired)
    return (
      <p role="status" className="text-sm text-amber-200">
        This code has expired. Check status to confirm the result before
        starting another sign-in.
      </p>
    );
  if (!authorization)
    return (
      <p className="text-sm text-slate-400">
        Waiting for {providerLabel}. If you already entered the code, keep this
        page open. For a new code, wait for this request to expire before
        starting again.
      </p>
    );
  return (
    <div className="space-y-4 border-y border-cyan-200/10 py-4">
      <p>Enter this one-time code at {providerLabel}:</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="select-all font-mono text-2xl font-semibold tracking-[0.18em] text-cyan-50">
          {authorization.userCode}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(authorization.userCode);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            })();
          }}
        >
          <Copy aria-hidden="true" className="size-4" />
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>
      <a
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-300 px-4 font-medium text-slate-950"
        href={authorization.verificationURL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open {providerLabel}
        <ExternalLink aria-hidden="true" className="size-4" />
      </a>
      <p className="text-xs text-slate-400">
        Keep this page open while you sign in. The code expires at{" "}
        {new Date(authorization.expiresAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
        .
      </p>
    </div>
  );
}

function KeyUpdateContinuation({
  submit,
  method,
}: {
  submit(credential: string): Promise<void>;
  method?: CredentialImportMethod | undefined;
}) {
  const [open, setOpen] = useState(false);
  const entered = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          formRef.current?.reset();
          setLoading(false);
          setError("");
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
            />
          }
        >
          {method ? "Continue account import" : "Continue key update"}
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>
            {method ? "Continue account import" : "Continue key update"}
          </Dialog.Title>
          <Dialog.Description>
            Old review access is blocked. Enter the credential again to continue
            this original account update.
          </Dialog.Description>
          <form
            ref={formRef}
            className="mt-4 grid gap-4"
            onInput={() => setError("")}
            onSubmit={(event) => {
              event.preventDefault();
              if (entered.current || loading) return;
              setError("");
              const form = event.currentTarget;
              const values = new FormData(form);
              const credential = String(values.get("credential") ?? "");
              if (method && !validCredentialImportText(credential)) {
                setError("Enter valid text of 64 KiB or smaller.");
                return;
              }
              entered.current = true;
              form.reset();
              values.delete("credential");
              values.delete("credentialFile");
              setOpen(false);
              void submit(credential);
            }}
          >
            {method ? (
              <CredentialImportFields
                method={method}
                loading={setLoading}
                validationErrorId={error ? errorId : undefined}
              />
            ) : (
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
            )}
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-amber-200">
                {error}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit" disabled={loading}>
                {loading ? "Reading file…" : "Continue update"}
              </Button>
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
  inline = false,
  provider,
  context,
  nonce,
  autoOpen,
  consumeAutoOpen,
  spent,
  spend,
  restorePreEntry,
  accept,
  completeOAuth,
  completeNative,
  managementScope,
}: {
  inline?: boolean;
  provider?: OAuthCompletionPresentation | undefined;
  context: string;
  nonce: string;
  autoOpen: boolean;
  consumeAutoOpen(): void;
  spent: boolean;
  spend(): void;
  restorePreEntry(): void;
  accept(result: AccountsResult<AccountOperationView>): Promise<void>;
  completeOAuth: AccountGatewayManagementApi["completeGatewayOAuth"];
  completeNative?:
    | AccountGatewayManagementApi["continueGatewayNativeConnection"]
    | undefined;
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
  async function complete(authorizationResult: string) {
    if (submitting.current || spent) return;
    submitting.current = true;
    spend(); // The nonce owner retains this across child unmounts and stale polls.
    setBusy(true);
    setMessage("");
    try {
      // Grammar belongs to the original operation's profile, never to the
      // contents of a pasted secret. Neither credential enters cache/storage.
      const result = completeNative
        ? await completeNative(context, nonce, {
            completion: authorizationResult,
          })
        : await completeOAuth(context, {
            nonce,
            ...(!provider
              ? { authorizationResult }
              : provider.inputKind === "authorization_code"
                ? { authorizationCode: authorizationResult }
                : { callbackURL: authorizationResult }),
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
  const fields = (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const field = form.elements.namedItem(
          "callbackURL",
        ) as HTMLInputElement;
        const callbackURL = completeNative ? field.value : field.value.trim();
        field.value = "";
        form.reset(); // Clear the uncontrolled secret BEFORE any await.
        void complete(callbackURL);
      }}
    >
      <label className="grid gap-2 text-sm">
        {!provider
          ? "Callback URL or authorization code"
          : provider.inputKind === "authorization_code"
            ? "Authorization code"
            : "Authorization result address"}
        <input
          className={inputClass}
          type="text"
          name="callbackURL"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={completeNative ? 65536 : 16384}
          disabled={busy || spent}
        />
      </label>
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" disabled={busy || spent}>
        Complete authorization
      </Button>
    </form>
  );
  if (inline) return fields;
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
          Resume authorization
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Complete authorization</Dialog.Title>
          <Dialog.Description>
            {!provider
              ? "Paste the full callback URL or authorization code shown after sign-in."
              : provider.inputKind === "authorization_code"
                ? `Finish sign-in and paste the full authorization code shown by ${provider.label}.`
                : "Finish sign-in in the browser tab. If it cannot return here, paste its final address below."}{" "}
            The value is cleared as soon as you submit it.
          </Dialog.Description>
          {fields}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountForm({
  inline = false,
  account,
  accounts = [],
  mode = "connect",
  profiles,
  disabled,
  disabledReason,
  submit,
  managementScope = "workspace",
}: {
  inline?: boolean;
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
  const [selectedId, setSelectedId] = useState(
    account?.profileId ?? profiles[0]?.id ?? "",
  );
  const selected =
    profiles.find((p) => p.id === selectedId) ??
    (inline ? profiles[0] : undefined);
  const setup = useContext(ConnectWorkspaceContext);
  // Inside another flow the storage is already chosen there.
  const embedded = useConnectTarget() !== null;
  const apiKeyProvider = apiKeyProviderForGatewayProfile(selected);
  const [keyStorage, setKeyStorage] = useState<ApiKeyStorage>("reviewrouter");
  const githubIntent =
    apiKeyProvider && setup.workspaceId
      ? {
          provider: apiKeyProvider,
          storage: "github_secrets" as const,
          workspaceId: setup.workspaceId,
          repositoryIds: [],
        }
      : null;
  const keyURL = selected?.connection
    ? subscriptionKeyURL(selected.connection.provider)
    : undefined;
  const subscription = !!keyURL;
  const [labelValue, setLabelValue] = useState(
    account?.label ??
      suggestedAccountLabel(
        selected?.label ?? "Provider",
        accounts.map((candidate) => candidate.label),
      ),
  );
  const [automaticLabel, setAutomaticLabel] = useState(!account);
  const [manualURL, setManualURL] = useState(false);
  const [baseURL, setBaseURL] = useState(selected?.dedicatedBaseURL ?? "");
  const suggestion = (profile?: AccountProfileView) =>
    suggestedAccountLabel(
      profile?.label ?? "Provider",
      accounts.map((a) => a.label),
    );
  const activeProfileId = selected?.id;
  useEffect(() => {
    if (!inline || !activeProfileId || activeProfileId === selectedId) return;
    setSelectedId(activeProfileId);
    setKeyStorage("reviewrouter");
    setBaseURL(selected?.dedicatedBaseURL ?? "");
    setManualURL(false);
    if (automaticLabel) setLabelValue(suggestion(selected));
  }, [inline, activeProfileId, selectedId, selected, automaticLabel]);
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
  const credentialForm = useRef<HTMLFormElement>(null);
  const fields = (
    <form
      ref={credentialForm}
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (mode === "connect" && keyStorage === "github_secrets") return;
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
      {mode === "connect" && !inline ? (
        <SelectField
          name="profileId"
          label="Provider profile"
          value={selectedId}
          onValueChange={(value) => {
            const profile = profiles.find((p) => p.id === value);
            const credential =
              credentialForm.current?.querySelector<HTMLInputElement>(
                'input[name="credential"]',
              );
            if (credential) credential.value = "";
            setSelectedId(value);
            setKeyStorage("reviewrouter");
            setBaseURL(profile?.dedicatedBaseURL ?? "");
            setManualURL(false);
            if (automaticLabel) setLabelValue(suggestion(profile));
          }}
          options={profiles.map((p) => ({
            value: p.id,
            label: p.label,
            ...(p.connection?.planLabel
              ? { description: p.connection.planLabel }
              : {}),
          }))}
        />
      ) : null}
      {inline ? (
        <input type="hidden" name="profileId" value={profiles[0]?.id ?? ""} />
      ) : null}
      {apiKeyProvider && mode === "connect" && !embedded ? (
        <ApiKeyStorageChoice
          value={keyStorage}
          disabled={disabled}
          githubUnavailable={
            setup.workspaceId
              ? undefined
              : "Choose a workspace to set up GitHub Secrets."
          }
          onValueChange={(next) => {
            const credential =
              credentialForm.current?.querySelector<HTMLInputElement>(
                'input[name="credential"]',
              );
            if (credential) credential.value = "";
            setKeyStorage(next);
          }}
        />
      ) : null}
      {apiKeyProvider && mode === "reconnect" ? (
        <div className="grid gap-1 text-sm text-slate-300">
          <p>Key storage: {apiKeyStorageLabel("gateway_binding")}</p>
          <p className="text-xs text-slate-400">
            To change key storage, add a new provider.
          </p>
          {githubIntent ? (
            <a
              className="w-fit text-cyan-200 underline"
              href={apiKeySetupHref("providers", githubIntent)}
              onClick={() => {
                credentialForm.current?.reset();
                setOpen(false);
              }}
            >
              Add with different storage
            </a>
          ) : null}
        </div>
      ) : null}
      {mode === "connect" && keyStorage === "github_secrets" && githubIntent ? (
        <a
          className="w-fit font-semibold text-cyan-200 underline"
          href={apiKeySetupHref("providers", githubIntent)}
          onClick={() => {
            credentialForm.current?.reset();
            setOpen(false);
          }}
        >
          Continue to provider setup
        </a>
      ) : (
        <>
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
              <span className="flex items-center justify-between gap-3">
                {subscription ? "Subscription key" : "API key"}
                {keyURL ? (
                  <a
                    className="text-xs text-cyan-200 underline"
                    href={keyURL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get key
                  </a>
                ) : null}
              </span>
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
          {mode !== "rename" && subscription ? (
            <p className="text-xs text-slate-400">
              {selected?.connection?.provider === "kimi"
                ? "Use your Kimi Code key."
                : "Use your subscription key."}
            </p>
          ) : null}
          <Button type="submit" disabled={disabled || !endpointValid}>
            {mode === "connect" ? "Connect account" : "Confirm"}
          </Button>
        </>
      )}
    </form>
  );
  if (inline) return fields;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          const credential =
            credentialForm.current?.querySelector<HTMLInputElement>(
              'input[name="credential"]',
            );
          if (credential) credential.value = "";
        }
        if (next && mode !== "connect") setLabelValue(account?.label ?? "");
        if (next && mode === "connect") {
          const profile = profiles[0];
          setSelectedId(profile?.id ?? "");
          setKeyStorage("reviewrouter");
          setBaseURL(profile?.dedicatedBaseURL ?? "");
          setManualURL(false);
          setAutomaticLabel(true);
          setLabelValue(suggestion(profile));
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
          {fields}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
