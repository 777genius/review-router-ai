import { App } from "@octokit/app";
export interface UsageRunScope {
  repositoryId: string;
  runId: string;
  runAttempt: number;
  githubInstallationId: string | null;
  repositoryFullName: string | null;
}
/** Completion is obtained through App custody for the exact retained numeric run tuple. */
export function createProviderUsageRunCompletion(credentials: {
  appId: string;
  privateKey: string;
}) {
  const app = new App(credentials);
  return async (scope: UsageRunScope): Promise<Date | null> => {
    if (
      !scope.githubInstallationId ||
      !scope.repositoryFullName ||
      !/^\d+$/.test(scope.repositoryId) ||
      !/^\d+$/.test(scope.runId)
    )
      throw new Error("usage_run_completion_unavailable");
    const [owner, repo] = scope.repositoryFullName.split("/");
    if (!owner || !repo) throw new Error("usage_run_completion_unavailable");
    const client = await app.getInstallationOctokit(
      Number(scope.githubInstallationId),
    );
    const { data } = await client.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
      {
        owner,
        repo,
        run_id: Number(scope.runId),
        attempt_number: scope.runAttempt,
      },
    );
    if (
      String(data.id) !== scope.runId ||
      String(data.repository.id) !== scope.repositoryId ||
      data.run_attempt !== scope.runAttempt
    )
      throw new Error("usage_scope_mismatch");
    if (data.status !== "completed") return null;
    const jobs = await client.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs",
      {
        owner,
        repo,
        run_id: Number(scope.runId),
        attempt_number: scope.runAttempt,
        per_page: 100,
      },
    );
    if (
      jobs.data.total_count > 100 ||
      !jobs.data.jobs.length ||
      jobs.data.jobs.some((job) => !job.completed_at)
    )
      throw new Error("usage_run_completion_unavailable");
    const latest = Math.max(
      ...jobs.data.jobs.map((job) => Date.parse(job.completed_at!)),
    );
    if (!Number.isFinite(latest) || latest > Date.now() + 300000)
      throw new Error("usage_run_completion_unavailable");
    return new Date(latest);
  };
}
