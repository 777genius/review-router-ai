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
import { PersonalAccountControls } from "./personal-account-controls";

// The canonical connection and its sharing views use the same interactive cache.
export function PersonalAccountsPanel({
  bootstrap,
  api,
  management,
  managementApi,
}: {
  bootstrap: PersonalAccountsBootstrap;
  api: PersonalAccountsApi;
  management: AccountsBootstrap;
  managementApi: AccountGatewayManagementApi;
}) {
  const [client] = useState(() => new QueryClient());
  const refreshSharing = useCallback(async () => {
    const affected = client
      .getQueryCache()
      .findAll({ queryKey: ["personal-accounts", bootstrap.scope] });
    await Promise.all(
      affected
        .filter((query) =>
          ["sources", "grants", "organizations"].includes(
            String(query.queryKey[2]),
          ),
        )
        .map((query) =>
          client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
        ),
    );
  }, [client, bootstrap.scope]);
  return (
    <section
      className="space-y-6"
      aria-labelledby="personal-accounts-panel-title"
    >
      <div>
        <h3
          id="personal-accounts-panel-title"
          className="text-lg font-semibold text-cyan-50"
        >
          My personal accounts
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Connect an account once, then share it with organizations you
          administer. Every use keeps the same account, name, sign-in and review
          capacity. Sharing does not create another account or add capacity.
        </p>
      </div>
      <section
        className="space-y-4"
        aria-labelledby="personal-connections-title"
      >
        <div>
          <h4
            id="personal-connections-title"
            className="font-medium text-cyan-50"
          >
            Connect and manage
          </h4>
          <p className="mt-2 text-sm text-slate-400">
            Rename your account or update a supported API key here. To remove
            access from just one organization, use sharing below. Retiring an
            account removes every use, including your personal workspace.
          </p>
        </div>
        <AccountGatewayControls
          key={management.context}
          bootstrap={management}
          managementScope="personal"
          api={managementApi}
          queryClient={client}
          refreshRelated={refreshSharing}
        />
      </section>
      <PersonalAccountControls
        bootstrap={bootstrap}
        api={api}
        queryClient={client}
      />
    </section>
  );
}
