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
import { AccountsWorkspaceTabs } from "./accounts-workspace-tabs";
import { PersonalAccountControls } from "./personal-account-controls";
import { PersonalAccountsPanel } from "./personal-accounts-panel";
import { WorkspaceAccountsPanel } from "./workspace-accounts-panel";
import type { ApiKeySetupIntent } from "../../src/features/provider-setup/api-key-storage";

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
  const ownPanel =
    management && ownBootstrap && ownApi ? (
      <PersonalAccountsPanel
        bootstrap={ownBootstrap}
        api={ownApi}
        accessReadContext={management.context}
        workspaceId={workspaceId}
        setupIntent={setupIntent}
        management={management}
        managementApi={{
          listGatewayAccounts: personalActions.listPersonalGatewayAccounts,
          mutateGatewayAccount: personalActions.mutatePersonalGatewayAccount,
          submitGatewayApiKey: personalActions.submitPersonalGatewayKey,
          readGatewayOperation: personalActions.readPersonalGatewayOperation,
          beginGatewayOAuth: personalActions.beginPersonalGatewayOAuth,
          pollGatewayOAuth: personalActions.pollPersonalGatewayOAuth,
          completeGatewayOAuth: personalActions.completePersonalGatewayOAuth,
        }}
      />
    ) : (
      <PersonalAccountControls
        {...(ownBootstrap ? { bootstrap: ownBootstrap } : {})}
        {...(ownApi ? { api: ownApi } : {})}
      />
    );
  // Same page-block shell as the organization branch: the Accounts region is
  // the page's top anchor on both kinds of workspace (the panel keeps its own
  // "My connections" heading and description inside).
  if (personalScope)
    return (
      <section
        className="space-y-5 border-b border-cyan-200/10 pb-6"
        aria-label="Accounts"
      >
        {ownPanel}
      </section>
    );

  const modelApi = personalService
    ? {
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
      }
    : undefined;
  const inventoryPage =
    personalService && recipient
      ? await personalService
          .overview(workspaceId)
          .then((reader) => reader.list({ limit: 25 }))
          .catch(() => ({ status: "unavailable" as const }))
      : undefined;
  const personalConnect = management ? (
    <AccountGatewayControls
      bootstrap={management}
      managementScope="personal"
      workspaceId={workspaceId}
      setupIntent={setupIntent}
      connectOnly
      api={{
        listGatewayAccounts: personalActions.listPersonalGatewayAccounts,
        mutateGatewayAccount: personalActions.mutatePersonalGatewayAccount,
        submitGatewayApiKey: personalActions.submitPersonalGatewayKey,
        readGatewayOperation: personalActions.readPersonalGatewayOperation,
        beginGatewayOAuth: personalActions.beginPersonalGatewayOAuth,
        pollGatewayOAuth: personalActions.pollPersonalGatewayOAuth,
        completeGatewayOAuth: personalActions.completePersonalGatewayOAuth,
      }}
    />
  ) : null;
  const available =
    personalService && recipient ? (
      <div className="space-y-4">
        {recipient.canDetach ? (
          <AccountsAddDialog
            own={ownPanel}
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
        ) : null}
        <WorkspaceAccountsPanel
          key={workspaceId}
          bootstrap={bootstrap ?? { context: "", page: { status: "denied" } }}
          workspaceId={workspaceId}
          scope={`${personalService.scope}:workspace:${workspaceId}`}
          api={modelApi}
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
      </div>
    ) : bootstrap ? (
      <AccountGatewayControls
        key={bootstrap.context || workspaceId}
        bootstrap={bootstrap}
        workspaceId={workspaceId}
        setupIntent={setupIntent}
      />
    ) : (
      <p className="text-sm text-slate-400">
        Connections are temporarily unavailable. Refresh the page.
      </p>
    );

  return (
    <section
      className="space-y-5 border-b border-cyan-200/10 pb-6"
      aria-label="Accounts"
    >
      <p className="text-sm text-slate-400">
        {workspaceName
          ? `Connections available for ${workspaceName}.`
          : "Available connections."}{" "}
        Access enables reviews but does not change Models settings.
      </p>
      <AccountsWorkspaceTabs
        key={workspaceId}
        available={available}
        own={ownPanel}
      />
    </section>
  );
}
