"use client";

import { useMemo, useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import type { AccountsBootstrap } from "../../src/server/account-gateway-accounts";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
} from "../../src/features/account-gateway/personal-accounts";
import {
  AccountGatewayControls,
  type AccountGatewayManagementApi,
  type AddConnectionToWorkspace,
} from "./account-gateway-account-controls";
import {
  PersonalAccountControls,
  type PersonalWorkspaceList,
} from "./personal-account-controls";
import { personalAccountAccessReads } from "./personal-account-access-api";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";
import type { ApiKeySetupIntent } from "../../src/features/provider-setup/api-key-storage";

export function PersonalAccountsPanel({
  bootstrap,
  api,
  management,
  managementApi,
  workspaceId,
  accessReadContext,
  setupIntent,
  initiallyOpenConnect = false,
  addToWorkspace,
  connectEntry,
  workspaceList,
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
  management: AccountsBootstrap;
  managementApi: AccountGatewayManagementApi;
  workspaceId?: string;
  accessReadContext?: string;
  setupIntent?: ApiKeySetupIntent | undefined;
  initiallyOpenConnect?: boolean;
  addToWorkspace?: AddConnectionToWorkspace | undefined;
  connectEntry?: ReactNode;
  workspaceList?: PersonalWorkspaceList | undefined;
}) {
  const readApi = useMemo(
    () =>
      accessReadContext
        ? { ...api, ...personalAccountAccessReads(accessReadContext) }
        : api,
    [accessReadContext, api],
  );
  const options = useCurrentGatewayModelAccountsCache();
  const [fallback] = useState(() => new QueryClient());
  const client = options?.client ?? fallback;
  return (
    <section
      id="your-accounts"
      className="space-y-4"
      aria-label="Personal connection management"
    >
      <AccountGatewayControls
        key={management.context}
        bootstrap={management}
        managementScope="personal"
        workspaceId={workspaceId}
        setupIntent={setupIntent}
        initiallyOpenConnect={initiallyOpenConnect}
        addToWorkspace={addToWorkspace}
        connectEntry={connectEntry}
        api={managementApi}
        queryClient={client}
        renderAccounts={(accounts, actions) => (
          <PersonalAccountControls
            bootstrap={bootstrap}
            api={readApi}
            queryClient={client}
            currentWorkspaceId={workspaceId}
            managementRows={accounts}
            managementActions={actions}
            workspaceList={workspaceList}
          />
        )}
      />
    </section>
  );
}
