"use client";

import { useCallback, useMemo, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { accountsCopy } from "./accounts-copy";
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
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
  management: AccountsBootstrap;
  managementApi: AccountGatewayManagementApi;
  workspaceId?: string;
  accessReadContext?: string;
  setupIntent?: ApiKeySetupIntent | undefined;
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
  const refreshSharing = useCallback(
    () => refreshPersonalAccountViews(client, bootstrap.scope, false),
    [client, bootstrap.scope],
  );
  return (
    <section
      id="your-accounts"
      className="space-y-4"
      aria-labelledby="personal-accounts-panel-title"
    >
      <div>
        <h3
          id="personal-accounts-panel-title"
          className="text-lg font-semibold text-cyan-50"
        >
          {accountsCopy.own}
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Connect an account once and choose where it can be used. Ownership and
          credentials stay personal.
        </p>
      </div>
      <AccountGatewayControls
        key={management.context}
        bootstrap={management}
        managementScope="personal"
        workspaceId={workspaceId}
        setupIntent={setupIntent}
        api={managementApi}
        queryClient={client}
        refreshRelated={refreshSharing}
        renderAccounts={(accounts, actions) => (
          <PersonalAccountControls
            bootstrap={bootstrap}
            api={readApi}
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
