import type { RepositoryScanSnapshot } from "../../src/features/repository-scan/repository-scan-model";

export const repositoryScanKey = (actorId: string, workspaceId: string) =>
  ["repository-scan", actorId, workspaceId] as const;

export class RepositoryScanRequestError extends Error {
  constructor(readonly status: number) {
    super("Repository scan status unavailable");
    this.name = "RepositoryScanRequestError";
  }
}

export const isRepositoryScanAccessFailure = (error: unknown): boolean =>
  error instanceof RepositoryScanRequestError &&
  (error.status === 401 || error.status === 403);

export async function fetchRepositoryScan(
  workspaceId: string,
  signal: AbortSignal,
): Promise<RepositoryScanSnapshot> {
  const params = new URLSearchParams({ workspace: workspaceId });
  const response = await fetch(`/api/dashboard/repositories/scan?${params}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new RepositoryScanRequestError(response.status);
  return (await response.json()) as RepositoryScanSnapshot;
}
