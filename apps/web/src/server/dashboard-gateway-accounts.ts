import { mapWithConcurrency } from "@reviewrouter/shared";
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

/** Resolve every selected binding independently; list pagination and a shared profile catalog cannot decide readiness. */
export async function hydrateDashboardGatewayAccounts(
  workspaceId: string,
  personal: DashboardPersonalAccounts | null,
  initial: AccountsResult<AccountsPage> | undefined,
  selectedBindingIds: readonly string[],
): Promise<AccountsResult<AccountsPage> | undefined> {
  const ids = [...new Set(selectedBindingIds)];
  if (!ids.length) return initial;
  try {
    const reader = personal
      ? await personal.models(workspaceId)
      : (await productionGatewayModelAccounts(workspaceId)).reader;
    const details = await mapWithConcurrency(ids, 5, async (id) => ({
      id,
      result: await reader
        .get(id)
        .catch(() => ({ status: "unavailable" as const })),
    }));
    const accounts = new Map(
      (initial?.status === "ok" ? initial.value.accounts : []).flatMap(
        (account) =>
          account.binding ? [[account.binding.id, account] as const] : [],
      ),
    );
    const profiles = new Map(
      (initial?.status === "ok" ? initial.value.profiles : []).map(
        (profile) => [profile.id, profile] as const,
      ),
    );
    for (const { id, result } of details) {
      accounts.delete(id);
      if (result.status !== "ok" || result.value.account.binding?.id !== id)
        continue;
      const { account, profile } = result.value;
      accounts.set(id, account);
      if (!profiles.has(profile.id)) profiles.set(profile.id, profile);
    }
    return {
      status: "ok",
      value: {
        accounts: [...accounts.values()],
        profiles: [...profiles.values()],
        nextCursor: initial?.status === "ok" ? initial.value.nextCursor : null,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
