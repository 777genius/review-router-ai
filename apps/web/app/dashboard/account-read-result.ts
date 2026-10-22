// Query adapters retain the previous safe display on a transient outage. An
// authorization/conflict result still replaces it, so stale rows grant no access.
export async function readAccountResult<T extends { status: string }>(
  read: Promise<T>,
): Promise<T> {
  const result = await read;
  if (result.status === "unavailable")
    throw new Error("account-read-unavailable");
  return result;
}
