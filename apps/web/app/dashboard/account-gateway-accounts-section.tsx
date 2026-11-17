import type { ReactNode } from "react";
import { loadAccountsBootstrap } from "../../src/server/account-gateway-accounts";
import { getPrisma } from "../../src/server/prisma";
import { productionPersonalAccounts } from "../../src/server/personal-account-composition";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
} from "../../src/features/account-gateway/personal-accounts";
import * as personalActions from "./personal-account-actions";
import { AccountGatewayControls } from "./account-gateway-account-controls";
import { AccountsAddDialog } from "./accounts-add-dialog";
import { PersonalAccountControls } from "./personal-account-controls";
import { PersonalAccountsPanel } from "./personal-accounts-panel";
import { WorkspaceAccountsPanel } from "./workspace-accounts-panel";
import type { ApiKeySetupIntent } from "../../src/features/provider-setup/api-key-storage";
import { accountsCopy } from "./accounts-copy";
import { connectionSetupContinuation } from "../../src/features/provider-setup/connection-setup-continuation";
import { getDashboardMutationStatus } from "../../src/server/dashboard-mutations";

function ConnectionsSection({
  description,
  children,
}: {
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      className="space-y-5 border-b border-cyan-200/10 pb-6"
      aria-label="Connections"
    >
      <div>
        <h3 className="text-lg font-semibold text-cyan-50">Connections</h3>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

export async function AccountGatewayAccountsSection({
  workspaceId,
  workspaceName,
  personalAccounts,
  personalAccountsApi,
  setupIntent,
}: {
  workspaceId: string;
  workspaceName?: string;
  personalAccounts?: PersonalAccountsBootstrap;
  personalAccountsApi?: PersonalAccountsApi;
  setupIntent?: ApiKeySetupIntent | undefined;
}) {
  const viewer = await getDashboardMutationStatus();
  let personalService: Awaited<ReturnType<typeof productionPersonalAccounts>> =
    null;
  try {
    personalService = await productionPersonalAccounts();
  } catch {
    /* Render safe unavailable bootstrap below. */
  }
  const enabled = readPersonalAccountSharingEnabled(process.env);
  const selected = enabled
    ? await getPrisma().workspace.findUnique({
        where: { id: workspaceId },
        select: { personalOwnerUserId: true },
      })
    : null;
  const personalScope = selected?.personalOwnerUserId != null;
  const recipient =
    personalService && !personalScope
      ? await personalService.workspaceAccess(workspaceId).catch(() => null)
      : null;
  const bootstrap = personalScope
    ? null
    : await loadAccountsBootstrap(workspaceId);
  const ownBootstrap = personalService
    ? {
        enabled: true,
        scope: personalService.scope,
        page: await personalService.sharing.listSources({ limit: 25 }),
      }
    : personalAccounts;
  const ownApi = personalService
    ? {
        listSources: personalActions.listPersonalSources.bind(
          null,
          personalService.scope,
        ),
        listOwnGrants: personalActions.listPersonalGrants.bind(
          null,
          personalService.scope,
        ),
        listAccessSummaries: personalActions.listPersonalAccessSummaries.bind(
          null,
          personalService.scope,
        ),
        listEligibleOrganizations:
          personalActions.listPersonalOrganizations.bind(
            null,
            personalService.scope,
          ),
        attach: personalActions.attachPersonalAccount.bind(
          null,
          personalService.scope,
        ),
        revoke: personalActions.revokePersonalAccount.bind(
          null,
          personalService.scope,
        ),
        readOperation: personalActions.readPersonalSharingOperation.bind(
          null,
          personalService.scope,
        ),
      }
    : personalAccountsApi;
  const management = personalService
    ? {
        context: personalService.scope,
        page: await personalService.canonical.listGatewayAccounts(
          personalService.scope,
          null,
        ),
      }
    : null;
  const managementApi = {
    listGatewayAccounts: personalActions.listPersonalGatewayAccounts,
    mutateGatewayAccount: personalActions.mutatePersonalGatewayAccount,
    submitGatewayApiKey: personalActions.submitPersonalGatewayKey,
    readGatewayOperation: personalActions.readPersonalGatewayOperation,
    beginGatewayOAuth: personalActions.beginPersonalGatewayOAuth,
    pollGatewayOAuth: personalActions.pollPersonalGatewayOAuth,
    completeGatewayOAuth: personalActions.completePersonalGatewayOAuth,
  };
  // A connection made while viewing a shared workspace is added to it when the
  // owner may grant it there. The personal workspace gets its binding from connect.
  const addToWorkspace =
    personalService && !personalScope
      ? personalActions.attachConnectedPersonalAccount.bind(
          null,
          personalService.scope,
          workspaceId,
        )
      : undefined;
  const ownPanel = (
    extra: Pick<
      Parameters<typeof PersonalAccountsPanel>[0],
      "initiallyOpenConnect" | "connectEntry" | "workspaceList"
    > = {},
  ) =>
    management && ownBootstrap && ownApi ? (
      <PersonalAccountsPanel
        bootstrap={ownBootstrap}
        api={ownApi}
        accessReadContext={management.context}
        workspaceId={workspaceId}
        setupIntent={setupIntent}
        management={management}
        addToWorkspace={addToWorkspace}
        managementApi={managementApi}
        {...extra}
      />
    ) : (
      <PersonalAccountControls
        {...(ownBootstrap ? { bootstrap: ownBootstrap } : {})}
        {...(ownApi ? { api: ownApi } : {})}
      />
    );
  if (personalScope)
    return (
      <ConnectionsSection description={accountsCopy.ownDescription}>
        {ownPanel({
          initiallyOpenConnect: connectionSetupContinuation({
            intent: setupIntent,
            workspace: undefined,
            personal: management?.page,
          }).autoOpen,
        })}
      </ConnectionsSection>
    );

  const inventoryPage =
    personalService && recipient
      ? await personalService
          .overview(workspaceId)
          .then((reader) => reader.list({ limit: 25 }))
          .catch(() => ({ status: "unavailable" as const }))
      : undefined;
  const continuation = connectionSetupContinuation({
    intent: setupIntent,
    workspace: bootstrap?.page,
    personal: management?.page,
    available: inventoryPage,
  });
  const organizationControls = bootstrap ? (
    <AccountGatewayControls
      key={bootstrap.context || workspaceId}
      bootstrap={bootstrap}
      workspaceId={workspaceId}
      setupIntent={setupIntent}
      initiallyOpenConnect={continuation.autoOpen}
    />
  ) : (
    <p className="text-sm text-slate-400">
      Connections are temporarily unavailable. Refresh the page.
    </p>
  );
  // One list needs the live role here and the viewer's own connections. If
  // either is unreadable, show the workspace's own controls and then the
  // viewer's connections, as before, without combining them.
  if (!personalService || !recipient || !management)
    return (
      <ConnectionsSection description={accountsCopy.listDescription}>
        {organizationControls}
        {ownPanel()}
      </ConnectionsSection>
    );

  const overviewScope = `${personalService.scope}:workspace:${workspaceId}`;
  const personalConnect = (
    <AccountGatewayControls
      bootstrap={management}
      managementScope="personal"
      workspaceId={workspaceId}
      setupIntent={setupIntent}
      connectOnly
      addToWorkspace={addToWorkspace}
      api={managementApi}
    />
  );
  return (
    <ConnectionsSection description={accountsCopy.listDescription}>
      {ownPanel({
        // Members connect their own account; the result says why it is not
        // added here. Owners and admins choose who owns it in Add account.
        initiallyOpenConnect: !recipient.canDetach && continuation.autoOpen,
        connectEntry: recipient.canDetach ? (
          <AccountsAddDialog
            initiallyOpen={continuation.autoOpen}
            initialOwnership={continuation.ownership}
            personalConnect={personalConnect}
            organizationConnect={
              bootstrap ? (
                <AccountGatewayControls
                  bootstrap={bootstrap}
                  connectOnly
                  workspaceId={workspaceId}
                  setupIntent={setupIntent}
                />
              ) : null
            }
            workspaceName={workspaceName ?? "this organization"}
          />
        ) : undefined,
        workspaceList: {
          canAddHere: recipient.canDetach,
          viewer: {
            login: viewer.sourceLogin,
            avatarUrl: viewer.sourceAvatarUrl,
          },
          overviewScope,
          initialOverview: inventoryPage,
          sharedRows: (
            <WorkspaceAccountsPanel
              key={workspaceId}
              bootstrap={
                bootstrap ?? { context: "", page: { status: "denied" } }
              }
              workspaceId={workspaceId}
              scope={overviewScope}
              api={{
                list: personalActions.listWorkspaceAccountsOverview.bind(
                  null,
                  personalService.scope,
                  workspaceId,
                ),
                get: personalActions.getPersonalModelAccount.bind(
                  null,
                  personalService.scope,
                  workspaceId,
                ),
              }}
              initialPage={inventoryPage}
              personalScope={personalService.scope}
              canDetach={recipient.canDetach}
              readDetach={personalActions.readWorkspaceOverviewDetachment.bind(
                null,
                personalService.scope,
                workspaceId,
              )}
              detach={personalActions.detachWorkspaceOverviewAccount.bind(
                null,
                personalService.scope,
                workspaceId,
              )}
            />
          ),
        },
      })}
    </ConnectionsSection>
  );
}
