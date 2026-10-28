import { createHash } from "node:crypto";
import { createManagementClient } from "@agent-teams/account-gateway/http";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import {
  accountsServerAdapter,
  accountGatewayProfilesConfiguration,
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
} from "./account-gateway-accounts";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";
import { productionPersonalAccounts } from "./personal-account-composition";
import { getPrisma } from "./prisma";

/** Model selection also works for organization bindings with sharing disabled.
 * Reuses only the existing deployment management role in that mode. */
export async function productionGatewayModelAccounts(workspaceId: string) {
  const personal = await productionPersonalAccounts();
  if (personal)
    return {
      scope: personal.scope,
      reader: await personal.models(workspaceId),
    };
  const actor = await getDashboardSignedInActor();
  if (!actor?.userId) throw new ProviderAccountError("workspace_forbidden");
  const userId = actor.userId;
  const profiles = await (await accountsServerAdapter()).reviewCatalog();
  const settings = accountGatewayProfilesConfiguration();
  const reader = createGatewayModelAccountOptions({
    prisma: getPrisma(),
    env: process.env,
    profiles,
    ...(settings.operatorWorkspaceId
      ? { operatorWorkspaceId: settings.operatorWorkspaceId }
      : {}),
    gateway: createManagementClient({
      role: "management",
      origin: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "",
      token: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "",
      timeoutMs: 10000,
      responseBytes: 65536,
    }),
    ownerRef: (owner) =>
      owner.kind === "user"
        ? accountGatewayUserOwnerRef(owner.userId)
        : accountGatewayWorkspaceOwnerRef(owner.workspaceId),
    authorizeWorkspace: async () => {
      const current = await getDashboardSignedInActor();
      if (current?.userId !== userId)
        throw new ProviderAccountError("workspace_forbidden");
      return { workspaceId, actor: { userId } };
    },
  });
  return {
    scope: `gateway-model-${createHash("sha256").update(`rr-model-ui-v1\0${userId}`).digest("hex")}`,
    reader,
  };
}
