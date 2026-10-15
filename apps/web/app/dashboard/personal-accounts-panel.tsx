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
    <>
      <section
        className="space-y-4 border-b border-cyan-200/10 pb-6"
        aria-labelledby="personal-connections-title"
      >
        <div>
          <h3
            id="personal-connections-title"
            className="text-lg font-semibold text-cyan-50"
          >
            My personal connections
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Connect once, then choose the organizations that can use the account
            below. Names, credentials and capacity stay shared across all uses.
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
    </>
  );
}
