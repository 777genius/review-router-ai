import type { ProviderUsageReport, UsageFilters } from "./provider-usage-model";

export function normalizeUsageFilters(filters: UsageFilters): UsageFilters {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as UsageFilters;
}
export const providerUsageKey = (workspaceId: string, filters: UsageFilters) =>
  ["provider-usage", workspaceId, normalizeUsageFilters(filters)] as const;

export class ProviderUsageError extends Error {
  constructor(readonly status: number) {
    super("Usage report unavailable");
    this.name = "ProviderUsageError";
  }
}
export async function fetchProviderUsage(
  workspaceId: string,
  filters: UsageFilters,
  signal?: AbortSignal,
): Promise<ProviderUsageReport> {
  const params = new URLSearchParams({ workspace: workspaceId });
  for (const [key, value] of Object.entries(normalizeUsageFilters(filters)))
    if (value) params.set(key, value);
  const response = await fetch(`/api/dashboard/provider-usage?${params}`, {
    ...(signal ? { signal } : {}),
    cache: "no-store",
  });
  if (!response.ok) throw new ProviderUsageError(response.status);
  return response.json();
}
