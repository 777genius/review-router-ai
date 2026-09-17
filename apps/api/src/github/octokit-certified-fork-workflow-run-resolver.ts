import { App } from "@octokit/app";

type OctokitRequester = {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};

type InstallationApp = {
  getInstallationOctokit(
    installationId: number,
  ): Promise<OctokitRequester> | OctokitRequester;
};

export class OctokitCertifiedForkWorkflowRunResolver {
  private readonly app: InstallationApp;

  constructor(options: {
    readonly appId?: string;
    readonly privateKey?: string;
    readonly app?: InstallationApp;
  }) {
    if (!options.app && (!options.appId || !options.privateKey)) {
      throw new Error("certified_fork_workflow_run_app_unavailable");
    }
    this.app =
      options.app ??
      new App({ appId: options.appId!, privateKey: options.privateKey! });
  }

  async resolveWorkflowRunPullRequest(input: {
    readonly repository: {
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
      readonly fullName: string;
      readonly owner: string;
    };
    readonly githubRunId: string;
    readonly githubRunAttempt: string;
    readonly eventName: "pull_request_target";
  }): Promise<number> {
    const installationId = positiveInteger(
      input.repository.githubInstallationId,
      "certified_fork_workflow_run_installation_invalid",
    );
    const runId = positiveInteger(
      input.githubRunId,
      "certified_fork_workflow_run_id_invalid",
    );
    const attempt = positiveInteger(
      input.githubRunAttempt,
      "certified_fork_workflow_run_attempt_invalid",
    );
    const [, repo, extra] = input.repository.fullName.split("/");
    if (!repo || extra || input.repository.owner.length === 0) {
      throw new Error("certified_fork_workflow_run_repository_invalid");
    }
    const octokit = await this.app.getInstallationOctokit(installationId);
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      {
        owner: input.repository.owner,
        repo,
        run_id: runId,
      },
    );
    return parseWorkflowRun(response.data, {
      eventName: input.eventName,
      repositoryId: input.repository.githubRepositoryId,
      attempt,
    });
  }
}

function parseWorkflowRun(
  value: unknown,
  expected: {
    readonly eventName: "pull_request_target";
    readonly repositoryId: string;
    readonly attempt: number;
  },
): number {
  if (!isRecord(value) || !isRecord(value.repository)) {
    throw new Error("certified_fork_workflow_run_response_invalid");
  }
  if (
    value.event !== expected.eventName ||
    value.run_attempt !== expected.attempt ||
    String(value.repository.id ?? "") !== expected.repositoryId ||
    !Array.isArray(value.pull_requests) ||
    value.pull_requests.length !== 1 ||
    !isRecord(value.pull_requests[0])
  ) {
    throw new Error("certified_fork_workflow_run_identity_mismatch");
  }
  const pullRequestNumber = value.pull_requests[0].number;
  if (
    !Number.isSafeInteger(pullRequestNumber) ||
    (pullRequestNumber as number) < 1
  ) {
    throw new Error("certified_fork_workflow_run_pull_request_invalid");
  }
  return pullRequestNumber as number;
}

function positiveInteger(value: string, errorCode: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(errorCode);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(errorCode);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
