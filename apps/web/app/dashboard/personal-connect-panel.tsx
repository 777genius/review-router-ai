"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import type {
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import type { ApiKeySetupIntent } from "../../src/features/provider-setup/api-key-storage";
import { AccountGatewayControls } from "./account-gateway-account-controls";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import { attachConnectedPersonalAccount } from "./personal-account-actions";
import { personalManagementApi } from "./personal-management-api";

/** Where the signed-in user's new connections go: their scope and the
 * workspace they connect from. Navigation facts only; every action checks
 * the scope against the session. */
export type PersonalConnectPlace = Readonly<{
  scope: string;
  workspaceId: string;
  workspaceName: string;
}>;

const PersonalConnectContext = createContext<PersonalConnectPlace | null>(null);

export function PersonalConnectProvider({
  place,
  children,
}: {
  place: PersonalConnectPlace | null;
  children: ReactNode;
}) {
  return (
    <PersonalConnectContext.Provider value={place}>
      {children}
    </PersonalConnectContext.Provider>
  );
}

/** Null when personal connections cannot be made here. */
export function usePersonalConnectPlace(): PersonalConnectPlace | null {
  return useContext(PersonalConnectContext);
}

/**
 * The one form for connecting the user's own account from a workspace. The
 * connection belongs to the user and is added to the workspace it was made
 * from (66). Without a first page it reads one when it opens.
 */
export function PersonalConnectPanel({
  place,
  initialPage,
  setupIntent,
}: {
  place: PersonalConnectPlace;
  initialPage?: AccountsResult<AccountsPage> | undefined;
  setupIntent?: ApiKeySetupIntent | undefined;
}) {
  const cache = useCurrentGatewayModelAccountsCache();
  const [fallback] = useState(() => new QueryClient());
  const { scope, workspaceId, workspaceName } = place;
  const firstPage = useQuery(
    {
      queryKey: ["personal-connect-first-page", scope] as const,
      queryFn: () => personalManagementApi.listGatewayAccounts(scope, null),
      enabled: initialPage === undefined,
      // Read once per opening; the form's own list takes over from there.
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    },
    cache?.client ?? fallback,
  );
  const addToWorkspace = useCallback(
    (nonce: string) =>
      attachConnectedPersonalAccount(scope, workspaceId, nonce),
    [scope, workspaceId],
  );
  const page = initialPage ?? firstPage.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        You own this connection. It is added to {workspaceName} as soon as it
        connects.
      </p>
      {page ? (
        <AccountGatewayControls
          bootstrap={{ context: scope, page }}
          managementScope="personal"
          workspaceId={workspaceId}
          setupIntent={setupIntent}
          connectOnly
          addToWorkspace={addToWorkspace}
          api={personalManagementApi}
        />
      ) : firstPage.isError ? (
        <p role="status" className="text-sm text-slate-400">
          The connection form could not be loaded. Close and try again.
        </p>
      ) : (
        <p role="status" className="text-sm text-slate-400">
          Loading the connection form…
        </p>
      )}
    </div>
  );
}
