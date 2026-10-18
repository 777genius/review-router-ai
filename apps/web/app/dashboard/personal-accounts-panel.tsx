"use client";

import { useCallback, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import type { AccountsBootstrap } from "../../src/server/account-gateway-accounts";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
} from "../../src/features/account-gateway/personal-accounts";
import {
  AccountGatewayControls,
  type AccountGatewayManagementApi,
} from "./account-gateway-account-controls";
import {
  PersonalAccountControls,
  refreshPersonalAccountViews,
} from "./personal-account-controls";
import { useCurrentGatewayModelAccountsCache } from "./gateway-model-account-options";

export function PersonalAccountsPanel({
  bootstrap,
  api,
  management,
  managementApi,
  workspaceId,
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
  management: AccountsBootstrap;
  managementApi: AccountGatewayManagementApi;
  workspaceId?: string;
}) {
  const options = useCurrentGatewayModelAccountsCache();
  const [fallback] = useState(() => new QueryClient());
  const client = options?.client ?? fallback;
  const refreshSharing = useCallback(
    () => refreshPersonalAccountViews(client, bootstrap.scope, false),
    [client, bootstrap.scope],
  );
  return (
    <section
      id="your-accounts"
      className="space-y-4 border-b border-cyan-200/10 pb-6"
      aria-labelledby="personal-accounts-panel-title"
    >
      <div>
        <h3
          id="personal-accounts-panel-title"
          className="text-lg font-semibold text-cyan-50"
        >
          Your accounts
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Connect once and choose where it is available. Every workspace uses
          the same name, sign-in and review capacity.
        </p>
      </div>
      <AccountGatewayControls
        key={management.context}
        bootstrap={management}
        managementScope="personal"
        api={managementApi}
        queryClient={client}
        refreshRelated={refreshSharing}
        renderAccounts={(accounts, actions) => (
          <PersonalAccountControls
            bootstrap={bootstrap}
            api={api}
            queryClient={client}
            currentWorkspaceId={workspaceId}
            managementRows={accounts}
            managementActions={actions}
          />
        )}
      />
    </section>
  );
}
