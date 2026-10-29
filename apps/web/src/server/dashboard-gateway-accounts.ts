import { mapWithConcurrency } from "@reviewrouter/shared";
import {
  type AccountView,
  type AccountsPage,
  type AccountsResult,
} from "./account-gateway-accounts";
import type { ReviewConfiguration } from "@reviewrouter/features-review-config";
import { productionGatewayModelAccounts } from "./gateway-model-account-composition";
import { productionPersonalAccounts } from "./personal-account-composition";

export type DashboardPersonalAccounts = NonNullable<
  Awaited<ReturnType<typeof productionPersonalAccounts>>
>;

type GatewayAccountsReader = Pick<
  Awaited<ReturnType<typeof productionGatewayModelAccounts>>["reader"],
  "get"
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
    const selected = new Map<string, Set<string>>();
    for (const config of configurations) {
      for (const provider of config.providers) {
        if (provider.authMode !== "codex_account_gateway") continue;
        let profileRefs = selected.get(provider.gatewayBindingId);
        if (!profileRefs) {
          profileRefs = new Set<string>();
          selected.set(provider.gatewayBindingId, profileRefs);
        }
        profileRefs.add(provider.gatewayProfileRef);
      }
    }
    return await hydrateGatewayAccounts(reader, listed, selected);
  } catch {
    return { status: "unavailable" };
  }
}

/** Resolve every selected binding independently of the visible account page. */
export async function hydrateDashboardGatewayAccounts(
  workspaceId: string,
  personal: DashboardPersonalAccounts | null,
  initial: AccountsResult<AccountsPage> | undefined,
  selectedBindingIds: readonly string[],
): Promise<AccountsResult<AccountsPage> | undefined> {
  const ids = [...new Set(selectedBindingIds)];
  if (!ids.length || (initial && initial.status !== "ok")) return initial;
  try {
    const reader = personal
      ? await personal.models(workspaceId)
      : (await productionGatewayModelAccounts(workspaceId)).reader;
    // The configured profile catalog is independent of account pagination.
    // Never promote a detail's account-scoped models to a shared profile seed.
    const listed = initial ?? (await reader.list({ limit: 25 }));
    if (listed.status !== "ok") return listed;
    return await hydrateGatewayAccounts(
      reader,
      listed,
      new Map(ids.map((id) => [id, undefined] as const)),
    );
  } catch {
    return { status: "unavailable" };
  }
}

async function hydrateGatewayAccounts(
  reader: GatewayAccountsReader,
  initial: Extract<AccountsResult<AccountsPage>, { status: "ok" }>,
  selected: ReadonlyMap<string, ReadonlySet<string> | undefined>,
): Promise<AccountsResult<AccountsPage>> {
  if (!selected.size) return initial;
  const profiles = new Map(
    initial.value.profiles.map((profile) => [profile.id, profile]),
  );
  const visible = new Map(
    initial.value.accounts.flatMap((account) =>
      account.binding ? [[account.binding.id, account] as const] : [],
    ),
  );
  // Bound reads by unique selected binding, not by repository or reviewer count.
  const results = await mapWithConcurrency(
    [...selected],
    5,
    async ([id, expectedProfiles]) => {
      if (
        expectedProfiles &&
        ![...expectedProfiles].some((profileId) => profiles.has(profileId))
      )
        return [id, null] as const;
      try {
        const result = await reader.get(id);
        const previous = visible.get(id);
        if (
          result.status !== "ok" ||
          result.value.account.binding?.id !== id ||
          !profiles.has(result.value.account.profileId) ||
          (expectedProfiles &&
            !expectedProfiles.has(result.value.account.profileId)) ||
          result.value.profile.id !== result.value.account.profileId ||
          (previous && result.value.account.profileId !== previous.profileId)
        )
          return [id, null] as const;
        return [id, result.value.account] as const;
      } catch {
        return [id, null] as const;
      }
    },
  );
  const details = new Map<string, AccountView | null>(results);
  const accounts = initial.value.accounts.flatMap((account) => {
    const id = account.binding?.id;
    if (!id || !selected.has(id)) return [account];
    const detail = details.get(id);
    return detail ? [detail] : [];
  });
  for (const [id] of selected) {
    const account = details.get(id);
    if (account && !visible.has(id)) accounts.push(account);
  }
  return { status: "ok", value: { ...initial.value, accounts } };
}
