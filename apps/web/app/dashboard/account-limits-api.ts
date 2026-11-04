import type {
  AccountLimitsView,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";

export type AccountLimitsRequest = {
  context: string;
  connectionId: string;
  workspaceId?: string | undefined;
};

/** Explicit, owner-authorized quota metadata refresh; never runs a model. */
export async function refreshAccountLimits(
  request: AccountLimitsRequest,
): Promise<AccountsResult<AccountLimitsView>> {
  const { refreshAccountLimitsAction } =
    await import("./account-limits-actions");
  return refreshAccountLimitsAction({
    context: request.context,
    connectionId: request.connectionId,
    ...(request.workspaceId === undefined
      ? {}
      : { workspaceId: request.workspaceId }),
  });
}

/** Reads stored observations only. This endpoint never probes the provider. */
export async function readAccountLimits(
  request: AccountLimitsRequest,
  signal: AbortSignal,
): Promise<AccountsResult<AccountLimitsView>> {
  const params = new URLSearchParams({
    context: request.context,
    connectionId: request.connectionId,
  });
  if (request.workspaceId && request.context.startsWith("personal-"))
    params.set("workspaceId", request.workspaceId);
  const response = await fetch(`/api/dashboard/accounts/limits?${params}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401 || response.status === 403)
    return { status: "denied" };
  if (!response.ok) throw new Error("Saved account limits unavailable");
  return response.json();
}
