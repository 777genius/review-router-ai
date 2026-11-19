import { App } from "@octokit/app";
import {
  renderReviewSizeLimitNotice,
  reviewSizeLimitNoticeMarker,
  type ReviewSizeLimitNotice,
  type ReviewSizeLimitNoticePort,
} from "../review-size-limit-notice.js";

type OctokitRequester = {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};

type InstallationApp = {
  readonly octokit: OctokitRequester;
  getInstallationOctokit(
    installationId: number,
  ): Promise<OctokitRequester> | OctokitRequester;
};

/** 100 pages of 100 comments, the bound the other comment readers use. */
const maxCommentPages = 100;

/** Keeps one size-limit comment per pull request, written by the GitHub App. */
export class OctokitReviewSizeLimitNoticeGateway implements ReviewSizeLimitNoticePort {
  private readonly app: InstallationApp;
  private botLogin: string | null = null;

  constructor(
    options:
      | { readonly appId: string; readonly privateKey: string }
      | { readonly app: InstallationApp },
  ) {
    this.app =
      "app" in options
        ? options.app
        : (new App({
            appId: options.appId,
            privateKey: options.privateKey,
          }) as unknown as InstallationApp);
  }

  async publish(notice: ReviewSizeLimitNotice): Promise<void> {
    const [owner, repo, extra] = notice.repositoryFullName.split("/");
    const installationId = /^[1-9][0-9]*$/u.test(notice.githubInstallationId)
      ? Number(notice.githubInstallationId)
      : Number.NaN;
    if (
      !owner ||
      !repo ||
      extra !== undefined ||
      !Number.isSafeInteger(installationId)
    ) {
      throw new Error("review_size_limit_notice_target_invalid");
    }
    const [octokit, botLogin] = await Promise.all([
      this.app.getInstallationOctokit(installationId),
      this.resolveBotLogin(),
    ]);
    const body = renderReviewSizeLimitNotice(notice);
    const existing = await findNewestOwnedNotice(octokit, {
      owner,
      repo,
      pullRequestNumber: notice.pullRequestNumber,
      botLogin,
    });
    if (existing?.body === body) return;
    if (existing) {
      await octokit.request(
        "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        { owner, repo, comment_id: existing.id, body },
      );
      return;
    }
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      { owner, repo, issue_number: notice.pullRequestNumber, body },
    );
  }

  private async resolveBotLogin(): Promise<string> {
    if (this.botLogin) return this.botLogin;
    const response = await this.app.octokit.request("GET /app");
    const slug = isRecord(response.data) ? response.data.slug : undefined;
    if (typeof slug !== "string" || !/^[A-Za-z0-9-]+$/u.test(slug)) {
      throw new Error("review_size_limit_notice_app_identity_unavailable");
    }
    this.botLogin = `${slug.toLowerCase()}[bot]`;
    return this.botLogin;
  }
}

async function findNewestOwnedNotice(
  octokit: OctokitRequester,
  input: {
    readonly owner: string;
    readonly repo: string;
    readonly pullRequestNumber: number;
    readonly botLogin: string;
  },
): Promise<{ readonly id: number; readonly body: string } | null> {
  let newest: { readonly id: number; readonly body: string } | null = null;
  for (let page = 1; page <= maxCommentPages; page += 1) {
    const response = await octokit.request(
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
      throw new Error("review_size_limit_notice_comments_invalid");
    }
    for (const row of response.data) {
      if (!isRecord(row) || !isRecord(row.user)) continue;
      const { id, body } = row;
      if (
        typeof id === "number" &&
        Number.isSafeInteger(id) &&
        typeof body === "string" &&
        body.includes(reviewSizeLimitNoticeMarker) &&
        typeof row.user.login === "string" &&
        row.user.login.toLowerCase() === input.botLogin &&
        (newest === null || id > newest.id)
      ) {
        newest = { id, body };
      }
    }
    if (response.data.length < 100) return newest;
  }
  throw new Error("review_size_limit_notice_comments_pagination_exceeded");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
