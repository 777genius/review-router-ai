import { App } from "@octokit/app";
import { AuthorityError } from "@reviewrouter/features-sdk-growth-authority";
import type {
  ResolvedSdkGrowthExecution,
  SdkGrowthExecutionResolverPort,
} from "../sdk-growth-authority-routes.js";

type Requester = {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};

type InstallationApp = {
  getInstallationOctokit(id: number): Promise<Requester> | Requester;
};

export class OctokitSdkGrowthExecutionResolver implements SdkGrowthExecutionResolverPort {
  private readonly app: InstallationApp;

  constructor(input: {
    readonly appId?: string;
    readonly privateKey?: string;
    readonly app?: InstallationApp;
  }) {
    if (!input.app && (!input.appId || !input.privateKey))
      throw new Error("sdk_growth_github_app_unavailable");
    this.app =
      input.app ??
      new App({ appId: input.appId!, privateKey: input.privateKey! });
  }

  async resolve(input: {
    readonly installationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly runId: string;
    readonly runAttempt: string;
    readonly verifierRevision: string;
  }): Promise<ResolvedSdkGrowthExecution | null> {
    const installationId = integer(input.installationId);
    const runId = integer(input.runId);
    const runAttempt = integer(input.runAttempt);
    const [owner, repo, extra] = input.repositoryFullName.split("/");
    if (!owner || !repo || extra) throw new AuthorityError("wrong-identity");
    const octokit = await this.app.getInstallationOctokit(installationId);
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      { owner, repo, run_id: runId, request: { timeout: 10_000 } },
    );
    const run = record(response.data);
    const repository = record(run.repository);
    const headSha = run.head_sha;
    if (
      String(run.id) !== input.runId ||
      run.run_attempt !== runAttempt ||
      String(repository.id) !== input.githubRepositoryId ||
      String(repository.full_name).toLowerCase() !==
        input.repositoryFullName.toLowerCase() ||
      !commit(headSha)
    )
      return null;
    const commitResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      {
        owner,
        repo,
        commit_sha: headSha,
        request: { timeout: 10_000 },
      },
    );
    const gitCommit = record(commitResponse.data);
    const tree = record(gitCommit.tree);
    if (gitCommit.sha !== headSha || !commit(tree.sha)) return null;
    return {
      installationId: input.installationId,
      runId: input.runId,
      runAttempt: input.runAttempt,
      verifierRevision: input.verifierRevision,
      sourceCommit: headSha,
      sourceTree: tree.sha,
    };
  }
}

function integer(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new AuthorityError("wrong-identity");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AuthorityError("wrong-identity");
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("wrong-identity");
  return value as Record<string, unknown>;
}

function commit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}
