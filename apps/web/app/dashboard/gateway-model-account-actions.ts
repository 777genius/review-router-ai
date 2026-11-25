"use server";

import { productionGatewayModelAccounts } from "../../src/server/gateway-model-account-composition";

export async function listGatewayModelAccounts(
  scope: string,
  workspaceId: string,
  request: { afterBindingId?: string; limit: number },
) {
  try {
    const service = await productionGatewayModelAccounts(workspaceId);
    if (service.scope !== scope) return { status: "denied" as const };
    return service.reader.list(request);
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function getGatewayModelAccount(
  scope: string,
  workspaceId: string,
  bindingId: string,
  options: { readonly forceRefresh?: boolean } = {},
) {
  try {
    const service = await productionGatewayModelAccounts(workspaceId);
    if (service.scope !== scope) return { status: "denied" as const };
    return service.reader.get(bindingId, options);
  } catch {
    return { status: "unavailable" as const };
  }
}
