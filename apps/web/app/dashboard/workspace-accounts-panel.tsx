"use client";
import type { ComponentProps } from "react";
import type { AccountsBootstrap } from "../../src/server/account-gateway-accounts";
import { AccountGatewayControls } from "./account-gateway-account-controls";
import { WorkspacePersonalAccounts } from "./workspace-personal-accounts";

// Render callbacks stay in the client boundary; the RSC supplies only safe
// bootstrap data, React content and authenticated server actions.
export function WorkspaceAccountsPanel({
  bootstrap,
  ...props
}: ComponentProps<typeof WorkspacePersonalAccounts> & {
  bootstrap: AccountsBootstrap;
}) {
  if (!props.canDetach || !bootstrap.context)
    return <WorkspacePersonalAccounts {...props} />;
  return (
    <AccountGatewayControls
      hideConnect
      bootstrap={bootstrap}
      {...(props.workspaceId ? { workspaceId: props.workspaceId } : {})}
      renderAccounts={(accounts, actions) => (
        <WorkspacePersonalAccounts
          {...props}
          managementRows={accounts}
          managementActions={actions}
        />
      )}
    />
  );
}
