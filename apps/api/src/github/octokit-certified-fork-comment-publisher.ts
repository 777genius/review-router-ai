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

export type CertifiedForkCommentPublication = Readonly<{
  commentId: string;
  url?: string;
}>;

export class OctokitCertifiedForkCommentPublisher {
  private readonly app: InstallationApp;
  private readonly botLogin: string;

  constructor(options: {
    readonly appId?: string;
    readonly privateKey?: string;
    readonly appSlug: string;
    readonly app?: InstallationApp;
  }) {
    if (!/^[A-Za-z0-9-]+$/u.test(options.appSlug)) {
      throw new Error("certified_fork_comment_app_slug_invalid");
    }
    if (!options.app && (!options.appId || !options.privateKey)) {
      throw new Error("certified_fork_comment_app_unavailable");
    }
    this.app =
      options.app ??
      new App({ appId: options.appId!, privateKey: options.privateKey! });
    this.botLogin = `${options.appSlug.toLowerCase()}[bot]`;
  }

  async upsert(input: {
    readonly githubInstallationId: string;
    readonly repositoryFullName: string;
    readonly baseRepositoryId: string;
    readonly sourceRepositoryId: string;
    readonly pullRequestNumber: number;
    readonly baseSha: string;
    readonly reviewHeadSha: string;
    readonly marker: string;
    readonly body: string;
  }): Promise<CertifiedForkCommentPublication> {
    const installationId = Number(input.githubInstallationId);
    if (!Number.isSafeInteger(installationId) || installationId < 1) {
      throw new Error("certified_fork_comment_installation_invalid");
    }
    if (
      !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber < 1
    ) {
      throw new Error("certified_fork_comment_pull_request_invalid");
    }
    if (
      !/^<!-- reviewrouter:certified-fork:v1 [\x20-\x7e]+ -->$/u.test(
        input.marker,
      ) ||
      !input.body.startsWith(`${input.marker}\n`)
    ) {
      throw new Error("certified_fork_comment_marker_invalid");
    }
    const [owner, repo, extra] = input.repositoryFullName.split("/");
    if (!owner || !repo || extra) {
      throw new Error("certified_fork_comment_repository_invalid");
    }
    const octokit = await this.app.getInstallationOctokit(installationId);
    await assertPullRequestCurrent({
      octokit,
      owner,
      repo,
      baseRepositoryId: input.baseRepositoryId,
      sourceRepositoryId: input.sourceRepositoryId,
      pullRequestNumber: input.pullRequestNumber,
      baseSha: input.baseSha,
      reviewHeadSha: input.reviewHeadSha,
    });
    const commentId = await this.findOwnedComment({
      octokit,
      owner,
      repo,
      pullRequestNumber: input.pullRequestNumber,
      marker: input.marker,
    });
    const response =
      commentId === null
        ? await octokit.request(
            "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
            {
              owner,
              repo,
              issue_number: input.pullRequestNumber,
              body: input.body,
            },
          )
        : await octokit.request(
            "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
            {
              owner,
              repo,
              comment_id: commentId,
              body: input.body,
            },
          );
    return parseComment(response.data);
  }

  private async findOwnedComment(input: {
    readonly octokit: OctokitRequester;
    readonly owner: string;
    readonly repo: string;
    readonly pullRequestNumber: number;
    readonly marker: string;
  }): Promise<number | null> {
    const matches: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await input.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: input.owner,
          repo: input.repo,
          issue_number: input.pullRequestNumber,
          per_page: 100,
          page,
        },
      );
      if (!Array.isArray(response.data)) {
        throw new Error("certified_fork_comment_inventory_invalid");
      }
      for (const value of response.data) {
        const comment = parseInventoryComment(value);
        if (
          comment.body.startsWith(`${input.marker}\n`) &&
          comment.authorLogin.toLowerCase() === this.botLogin
        ) {
          matches.push(comment.id);
        }
      }
      if (response.data.length < 100) break;
      if (page === 3) {
        throw new Error("certified_fork_comment_inventory_budget_exceeded");
      }
    }
    if (matches.length > 1) {
      throw new Error("certified_fork_comment_marker_ambiguous");
    }
    return matches[0] ?? null;
  }
}

async function assertPullRequestCurrent(input: {
  readonly octokit: OctokitRequester;
  readonly owner: string;
  readonly repo: string;
  readonly baseRepositoryId: string;
  readonly sourceRepositoryId: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly reviewHeadSha: string;
}): Promise<void> {
  const response = await input.octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
    },
  );
  const value = response.data;
  if (
    !isRecord(value) ||
    value.number !== input.pullRequestNumber ||
    value.state !== "open" ||
    value.draft !== false ||
    value.merged !== false ||
    !isRecord(value.base) ||
    !isRecord(value.head) ||
    !isRecord(value.base.repo) ||
    !isRecord(value.head.repo) ||
    String(value.base.repo.id ?? "") !== input.baseRepositoryId ||
    String(value.head.repo.id ?? "") !== input.sourceRepositoryId ||
    typeof value.base.sha !== "string" ||
    value.base.sha.toLowerCase() !== input.baseSha ||
    typeof value.head.sha !== "string" ||
    value.head.sha.toLowerCase() !== input.reviewHeadSha
  ) {
    throw new Error("certified_fork_comment_pull_request_stale");
  }
}

function parseInventoryComment(value: unknown): {
  readonly id: number;
  readonly body: string;
  readonly authorLogin: string;
} {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new Error("certified_fork_comment_inventory_invalid");
  }
  if (
    !Number.isSafeInteger(value.id) ||
    typeof value.body !== "string" ||
    typeof value.user.login !== "string"
  ) {
    throw new Error("certified_fork_comment_inventory_invalid");
  }
  return {
    id: value.id as number,
    body: value.body,
    authorLogin: value.user.login,
  };
}

function parseComment(value: unknown): CertifiedForkCommentPublication {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) {
    throw new Error("certified_fork_comment_response_invalid");
  }
  if (value.html_url !== undefined && typeof value.html_url !== "string") {
    throw new Error("certified_fork_comment_response_invalid");
  }
  return Object.freeze({
    commentId: String(value.id),
    ...(typeof value.html_url === "string" ? { url: value.html_url } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
