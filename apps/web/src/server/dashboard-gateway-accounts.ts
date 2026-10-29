import {
  type AccountView,
  type AccountsPage,
  type AccountsResult,
} from "./account-gateway-accounts";
import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import { gatewayReadinessDiscoverySource } from "./dashboard-provider-setup-readiness";
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
  configurations: readonly ReviewConfiguration[] = [],
): Promise<AccountsResult<AccountsPage>> {
  try {
    const reader = personal
      ? await personal.models(workspaceId)
      : (await productionGatewayModelAccounts(workspaceId)).reader;
    const listed = await reader.list({ limit: 25 });
    if (listed.status !== "ok") return listed;
    const selected = new Set(
      configurations.flatMap((config) =>
        config.providers.flatMap((provider) =>
          provider.authMode === "codex_account_gateway"
            ? [provider.gatewayBindingId]
            : [],
        ),
      ),
    );
    // The bounded account page, not repository count, limits discovery reads.
    // Results stay on their exact binding; two accounts never share a catalog.
    const details = new Map<string, Promise<AccountView>>();
    const accounts = await Promise.all(
      listed.value.accounts.map(async (account): Promise<AccountView> => {
        const id = account.binding?.id;
        const profile = listed.value.profiles.find(
          (candidate) => candidate.id === account.profileId,
        );
        if (
          !id ||
          !selected.has(id) ||
          !profile ||
          !gatewayReadinessDiscoverySource(profile)
        )
          return account;
        let detail = details.get(id);
        if (!detail) {
          detail = (async () => {
            const unavailable = (): AccountView => ({
              ...account,
              modelCatalog: {
                status: "unknown",
                source: "legacy_profile",
                models: [],
              },
            });
            try {
              const result = await reader.get(id);
              if (
                result.status !== "ok" ||
                result.value.account.binding?.id !== id ||
                result.value.account.profileId !== account.profileId ||
                result.value.profile.id !== account.profileId
              )
                return unavailable();
              return result.value.account;
            } catch {
              return unavailable();
            }
          })();
          details.set(id, detail);
        }
        return detail;
      }),
    );
    return { status: "ok", value: { ...listed.value, accounts } };
  } catch {
    return { status: "unavailable" };
  }
}
