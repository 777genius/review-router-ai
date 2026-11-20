import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Cancels the matching reads, then reads them again; no older read lands after. */
export async function rereadQueries(
  client: QueryClient,
  matches: (key: QueryKey) => boolean,
): Promise<void> {
  const keys = client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter(matches);
  await Promise.all(
    keys.map((queryKey) => client.cancelQueries({ queryKey, exact: true })),
  );
  await Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey, exact: true })),
  );
}
