"use server";

import { productionPersonalAccounts } from "../../src/server/personal-account-composition";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { ZodError } from "zod";
import type {
  AccountIntent,
  AccountOAuthIntent,
  AccountOAuthReconnectIntent,
  AccountOAuthCompletion,
} from "../../src/server/account-gateway-accounts";
import type {
  PersonalAttachRequest,
  PersonalRevokeRequest,
} from "../../src/features/account-gateway/personal-accounts";

type Service = NonNullable<
  Awaited<ReturnType<typeof productionPersonalAccounts>>
>;
async function invoke<T>(
  context: string,
  run: (service: Service) => Promise<T>,
) {
  try {
    const service = await productionPersonalAccounts();
    if (!service || context !== service.scope)
      return { status: "denied" as const };
    return await run(service);
  } catch (error) {
    if (error instanceof ZodError) return { status: "invalid" as const };
    if (error instanceof ProviderAccountError) {
      if (
        error.code === "revision_conflict" ||
        error.code === "operation_conflict"
      )
        return { status: "conflict" as const };
      return {
        status:
          error.code === "invalid_input"
            ? ("invalid" as const)
            : ("denied" as const),
      };
    }
    return { status: "unavailable" as const };
  }
}
export async function listPersonalSources(
  context: string,
  request: { afterSourceId?: string; limit: number },
) {
  return invoke(context, ({ sharing }) => sharing.listSources(request));
}
export async function listPersonalGrants(
  context: string,
  request: { sourceId: string; afterBindingId?: string; limit: number },
) {
  return invoke(context, ({ sharing }) => sharing.listOwnGrants(request));
}
export async function listPersonalAccessSummaries(
  context: string,
  request: { sourceIds: readonly string[] },
) {
  return invoke(context, ({ sharing }) => sharing.listAccessSummaries(request));
}
export async function listPersonalOrganizations(
  context: string,
  request: {
    sourceIds: readonly string[];
    afterWorkspaceId?: string;
    limit: number;
  },
) {
  return invoke(context, ({ sharing }) =>
    sharing.listEligibleOrganizations(request),
  );
}
export async function attachPersonalAccount(
  context: string,
  request: PersonalAttachRequest,
) {
  return invoke(context, ({ sharing }) => sharing.attach(request));
}
export async function revokePersonalAccount(
  context: string,
  request: PersonalRevokeRequest,
) {
  return invoke(context, ({ sharing }) => sharing.revoke(request));
}
export async function readPersonalSharingOperation(
  context: string,
  nonce: string,
) {
  return invoke(context, ({ sharing }) => sharing.readOperation(nonce));
}
export async function listPersonalGatewayAccounts(
  context: string,
  cursor: string | null,
) {
  return invoke(context, ({ canonical }) =>
    canonical.listGatewayAccounts(context, cursor),
  );
}
export async function mutatePersonalGatewayAccount(
  context: string,
  request: AccountIntent,
) {
  // Original legacy operation readback remains available, but new retirement
  // must reserve the lifecycle journal's permanent local denial first.
  if (request?.kind === "disable") return { status: "denied" as const };
  return invoke(context, ({ canonical }) =>
    canonical.mutateGatewayAccount(context, request),
  );
}
export async function submitPersonalGatewayKey(
  context: string,
  request: AccountIntent,
  credential: string,
) {
  return invoke(context, ({ canonical }) =>
    canonical.submitGatewayApiKey(context, request, credential),
  );
}
export async function readPersonalGatewayOperation(
  context: string,
  nonce: string,
) {
  return invoke(context, ({ canonical }) =>
    canonical.readGatewayOperation(context, nonce),
  );
}
export async function beginPersonalGatewayOAuth(
  context: string,
  request: AccountOAuthIntent | AccountOAuthReconnectIntent,
) {
  return invoke(context, ({ canonical }) =>
    canonical.beginGatewayOAuth(context, request),
  );
}
export async function pollPersonalGatewayOAuth(context: string, nonce: string) {
  return invoke(context, ({ canonical }) =>
    canonical.pollGatewayOAuth(context, nonce),
  );
}
export async function completePersonalGatewayOAuth(
  context: string,
  request: AccountOAuthCompletion,
) {
  return invoke(context, ({ canonical }) =>
    canonical.completeGatewayOAuth(context, request),
  );
}

export async function listPersonalModelAccounts(
  context: string,
  workspaceId: string,
  request: { afterBindingId?: string; limit: number },
) {
  return invoke(context, async (service) =>
    (await service.models(workspaceId)).list(request),
  );
}
export async function getPersonalModelAccount(
  context: string,
  workspaceId: string,
  bindingId: string,
  options: { readonly forceRefresh?: boolean } = {},
) {
  return invoke(context, async (service) =>
    (await service.models(workspaceId)).get(bindingId, options),
  );
}
export async function detachRecipientPersonalAccount(
  context: string,
  workspaceId: string,
  request: { bindingId: string; expectedBindingRevision: number },
) {
  return invoke(context, async (service) => ({
    status: "ok" as const,
    value: await service.detachRecipient(workspaceId, request),
  }));
}

export async function listWorkspaceAccountsOverview(
  context: string,
  workspaceId: string,
  request: { afterBindingId?: string; limit: number },
) {
  return invoke(context, async (service) =>
    (await service.overview(workspaceId)).list(request),
  );
}

export async function detachWorkspaceOverviewAccount(
  context: string,
  workspaceId: string,
  request: { bindingId: string; expectedBindingRevision: number },
) {
  return invoke(context, async (service) => ({
    status: "ok" as const,
    value: await service.detachWorkspaceUse(workspaceId, request),
  }));
}
export async function readWorkspaceOverviewDetachment(
  context: string,
  workspaceId: string,
  request: { bindingId: string; expectedBindingRevision: number },
) {
  return invoke(context, async (service) => ({
    status: "ok" as const,
    value: await service.readWorkspaceDetachment(workspaceId, request),
  }));
}
