/** An account connection never grants permission to export arbitrary SCM source.
 * Pin the disposable fixture's immutable GitHub repository ID as well as its name:
 * a deleted or transferred repo name must not authorize a different repository. */
export function isQualifiedNvidiaSandboxRepository(
  source:
    | {
        readonly githubRepositoryId: string;
        readonly repositoryFullName: string;
      }
    | null
    | undefined,
): boolean {
  return (
    source?.githubRepositoryId === "1390973362" &&
    source.repositoryFullName.toLowerCase() ===
      "777genius/rr-hosted-pool-e2e-20260927"
  );
}
