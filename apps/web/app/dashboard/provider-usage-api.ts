import type {
  ProviderUsageReport,
  ProviderUsageScope,
  ProviderUsageSeedScope,
  ProviderUsageResponse,
  UsageFilters,
} from "./provider-usage-model";

export function normalizeUsageFilters(filters: UsageFilters): UsageFilters {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as UsageFilters;
}
export const providerUsageKey = (
  scope: ProviderUsageSeedScope,
  filters: UsageFilters,
) =>
  [
    "provider-usage",
    scope.actorId,
    scope.workspaceId,
    scope.effectiveAccess,
    scope.seedId,
    normalizeUsageFilters(filters),
  ] as const;

export class ProviderUsageError extends Error {
  constructor(readonly status: number) {
    super("Usage report unavailable");
    this.name = "ProviderUsageError";
  }
}
export const isProviderUsageAccessFailure = (error: unknown): boolean =>
  error instanceof ProviderUsageError && [401, 403, 409].includes(error.status);
export const isProviderUsageScopeMismatch = (error: unknown): boolean =>
  error instanceof ProviderUsageError && error.status === 409;
export async function fetchProviderUsage(
  workspaceId: string,
  filters: UsageFilters,
  signal: AbortSignal,
  expectedScope: ProviderUsageScope,
): Promise<ProviderUsageReport> {
  const params = new URLSearchParams({ workspace: workspaceId });
  for (const [key, value] of Object.entries(normalizeUsageFilters(filters)))
    if (value) params.set(key, value);
  const response = await fetch(`/api/dashboard/provider-usage?${params}`, {
    ...(signal ? { signal } : {}),
    cache: "no-store",
  });
  if (!response.ok) throw new ProviderUsageError(response.status);
  const data = (await response.json()) as ProviderUsageResponse;
  if (
    !data?.scope ||
    data.scope.actorId !== expectedScope.actorId ||
    data.scope.workspaceId !== expectedScope.workspaceId ||
    data.scope.effectiveAccess !== expectedScope.effectiveAccess
  )
    throw new ProviderUsageError(409);
  return data.report;
}
