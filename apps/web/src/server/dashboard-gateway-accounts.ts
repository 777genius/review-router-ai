import {
  type AccountsPage,
  type AccountsResult,
} from "./account-gateway-accounts";
import { productionGatewayModelAccounts } from "./gateway-model-account-composition";
import { productionPersonalAccounts } from "./personal-account-composition";

export type DashboardPersonalAccounts = NonNullable<
  Awaited<ReturnType<typeof productionPersonalAccounts>>
>;

/** Personal model accounts the signed-in user may use in this workspace. */
export async function loadDashboardPersonalAccounts(
  workspaceId: string,
): Promise<DashboardPersonalAccounts | null> {
  const personal = await productionPersonalAccounts().catch(() => null);
  if (!personal) return null;
  const access = await personal.workspaceAccess(workspaceId).catch(() => null);
  return access ? personal : null;
}

/** The accounts page the dashboard renders and reads Gateway readiness from. */
export async function loadDashboardGatewayAccounts(
  workspaceId: string,
  personal: DashboardPersonalAccounts | null,
): Promise<AccountsResult<AccountsPage>> {
  if (!personal)
    return productionGatewayModelAccounts(workspaceId)
      .then(({ reader }) => reader.list({ limit: 25 }))
      .catch(() => ({ status: "unavailable" as const }));
  return personal
    .models(workspaceId)
    .then((api) => api.list({ limit: 25 }))
    .catch(() => ({ status: "unavailable" as const }));
}
