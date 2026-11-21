import * as c from "@agent-teams/account-gateway/contracts";
import type { ManagementClient } from "@agent-teams/account-gateway/http";
import type { AccountProfileView } from "./account-gateway-accounts";
import type { AccountModelSettings } from "../features/account-gateway/connection-capabilities";

export type ScopedAccountModels =
  | { status: "unknown" | "unavailable" | "unsupported" }
  | {
      status: "snapshot";
      source: string;
      fetchedAt: string;
      expiresAt: string;
      models: readonly AccountModelSettings[];
    };

/** Explicit profile policy selects one wire contract; errors never negotiate versions. */
export async function readScopedAccountModels(
  profile: AccountProfileView,
  request: c.AccountModelsRequest,
  gateway: Partial<
    Pick<ManagementClient, "readAccountModels" | "readAccountModelsV2">
  >,
): Promise<ScopedAccountModels> {
  const policy = profile.connection?.modelPolicy;
  if (!policy)
    return gateway.readAccountModels
      ? c.accountModels.parse(await gateway.readAccountModels(request))
      : { status: "unsupported" };
  if (!gateway.readAccountModelsV2) return { status: "unsupported" };
  const result = c.accountModelsV2.parse(
    await gateway.readAccountModelsV2(request),
  );
  if (result.status !== "snapshot") return result;
  if (
    result.profileId !== profile.id ||
    result.sourceId !== policy.sourceId ||
    result.admission.unavailableFallback !== policy.unavailableFallback
  )
    return { status: "unknown" };
  return {
    status: "snapshot",
    source: result.sourceId,
    fetchedAt: result.fetchedAt,
    expiresAt: result.expiresAt,
    models: result.models,
  };
}
