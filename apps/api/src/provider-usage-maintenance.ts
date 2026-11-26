/** Preserve ownership until every task settles, then surface a sanitized failure. */
export async function settleProviderUsageMaintenance<T>(
  tasks: readonly Promise<T>[],
): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  if (settled.some((result) => result.status === "rejected"))
    throw new Error("provider_usage_maintenance_failed");
  return settled.map((result) => {
    if (result.status !== "fulfilled")
      throw new Error("provider_usage_maintenance_failed");
    return result.value;
  });
}
