import { App } from "@octokit/app";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import type { UsageRepositoryAuthority } from "./provider-usage-routes";
/** Actor comes from the App-read run, bound to exact numeric repository/run attempt. */
export function createProviderUsageActorResolver(
  prisma: PrismaClient,
  credentials: { appId: string; privateKey: string },
) {
  const app = new App(credentials);
  return async (
    auth: ReviewRunAuthorization,
    target: NonNullable<Awaited<ReturnType<UsageRepositoryAuthority>>>,
  ) => {
    const octokit = await app.getInstallationOctokit(
      Number(target.githubInstallationId),
    );
    const [owner, repo] = target.repositoryFullName.split("/");
    if (!owner || !repo) return null;
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
      {
        owner,
        repo,
        run_id: Number(auth.sourceRunId),
        attempt_number: Number(auth.sourceRunAttempt),
      },
    );
    if (
      String(data.id) !== auth.sourceRunId ||
      String(data.repository.id) !== target.githubRepositoryId ||
      String(data.run_attempt) !== auth.sourceRunAttempt
    )
      throw new Error("usage_actor_scope_mismatch");
    if (!data.actor?.id) return null;
    const user = await prisma.user.findUnique({
      where: { githubUserId: BigInt(data.actor.id) },
      select: { id: true },
    });
    return user?.id ?? null;
  };
}
