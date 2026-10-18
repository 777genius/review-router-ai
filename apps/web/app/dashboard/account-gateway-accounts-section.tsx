import { loadAccountsBootstrap } from "../../src/server/account-gateway-accounts";
import { getPrisma } from "../../src/server/prisma";
import { productionPersonalAccounts } from "../../src/server/personal-account-composition";
import * as personalActions from "./personal-account-actions";
import { AccountGatewayControls } from "./account-gateway-account-controls";
import { PersonalAccountControls } from "./personal-account-controls";
import { PersonalAccountsPanel } from "./personal-accounts-panel";
import { WorkspacePersonalAccounts } from "./workspace-personal-accounts";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
} from "../../src/features/account-gateway/personal-accounts";

export async function AccountGatewayAccountsSection({
  workspaceId,
  workspaceName,
  personalAccounts,
  personalAccountsApi,
}: {
  workspaceId: string;
  workspaceName?: string;
  personalAccounts?: PersonalAccountsBootstrap;
  personalAccountsApi?: PersonalAccountsApi;
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
  return (
    <>
      {management && ownBootstrap && ownApi ? (
        <PersonalAccountsPanel
          bootstrap={ownBootstrap}
          api={ownApi}
          workspaceId={workspaceId}
          management={management}
          managementApi={{
            listGatewayAccounts: personalActions.listPersonalGatewayAccounts,
            mutateGatewayAccount: personalActions.mutatePersonalGatewayAccount,
            submitGatewayApiKey: personalActions.submitPersonalGatewayKey,
            readGatewayOperation: personalActions.readPersonalGatewayOperation,
            beginGatewayOAuth: personalActions.beginPersonalGatewayOAuth,
            completeGatewayOAuth: personalActions.completePersonalGatewayOAuth,
          }}
        />
      ) : enabled && !personalService ? (
        <section
          aria-label="Personal accounts"
          className="border-b border-cyan-200/10 pb-6"
        >
          <h3 className="text-lg font-semibold text-cyan-50">Your accounts</h3>
          <p className="mt-2 text-sm text-slate-400">
            Personal accounts are temporarily unavailable. Refresh to try again.
          </p>
        </section>
      ) : (
        <PersonalAccountControls
          {...(ownBootstrap ? { bootstrap: ownBootstrap } : {})}
          {...(ownApi ? { api: ownApi } : {})}
        />
      )}
      <section
        className="space-y-4 border-b border-cyan-200/10 pb-6"
        aria-labelledby="workspace-accounts-title"
      >
        <div>
          <h3
            id="workspace-accounts-title"
            className="text-lg font-semibold text-cyan-50"
          >
            Accounts in {workspaceName ?? "this workspace"}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Available accounts can be selected in Models. Adding access does not
            change review settings.
          </p>
        </div>
        {personalService && recipient ? (
          <WorkspacePersonalAccounts
            scope={`${personalService.scope}:workspace:${workspaceId}`}
            api={{
              list: personalActions.listPersonalModelAccounts.bind(
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
            personalScope={personalService.scope}
            canDetach={recipient.canDetach}
            detach={personalActions.detachRecipientPersonalAccount.bind(
              null,
              personalService.scope,
              workspaceId,
            )}
          />
        ) : null}
        {bootstrap ? (
          <section
            className="space-y-4 border-b border-cyan-200/10 pb-6"
            aria-labelledby="gateway-accounts-title"
          >
            <div>
              <h3
                id="gateway-accounts-title"
                className="text-lg font-semibold text-cyan-50"
              >
                Workspace-owned accounts
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Workspace admins manage these connections.
              </p>
              <details className="mt-2 text-sm text-slate-400">
                <summary className="cursor-pointer">
                  Connection and privacy details
                </summary>
                <p className="mt-2">
                  Credentials are encrypted on our server and never returned
                  here or copied into review CI or repository secrets. The
                  provider receives review context. Authorized CI can use scoped
                  review access; tool environment filtering does not fully
                  isolate it. Codex authorization opens once; enrollment remains
                  pending until confirmed.
                </p>
              </details>
            </div>
            <AccountGatewayControls
              key={bootstrap.context || workspaceId}
              bootstrap={bootstrap}
            />
          </section>
        ) : null}
      </section>
    </>
  );
}
