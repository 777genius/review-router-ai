import { App } from "@octokit/app";
import { request } from "@octokit/request";
import { ContextToolsAccessFailure } from "../review-context-tools.js";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import type { ReviewRunGatewayCheckoutTarget } from "../review-run-gateway-checkout.js";

/** First-party read port: no installation bearer ever reaches CI or a model. */
export function createContextIssueReader(input: {
  appId: string;
  privateKey: string;
  resolveRepository(
    a: ReviewRunAuthorization,
  ): Promise<ReviewRunGatewayCheckoutTarget | null>;
}) {
  const app = new App({ appId: input.appId, privateKey: input.privateKey });
  const session = async (a: ReviewRunAuthorization) => {
    const target = await input.resolveRepository(a);
    if (!target)
      throw new ContextToolsAccessFailure("context_repository_unavailable");
    const installationId = Number(target.githubInstallationId),
      repositoryId = Number(target.githubRepositoryId);
    if (
      !Number.isSafeInteger(installationId) ||
      !Number.isSafeInteger(repositoryId)
    )
      throw new ContextToolsAccessFailure("context_repository_unavailable");
    try {
      const { data } = await app.octokit.request(
        "POST /app/installations/{installation_id}/access_tokens",
        {
          installation_id: installationId,
          repository_ids: [repositoryId],
          permissions: { issues: "read", pull_requests: "read" },
          request: { signal: AbortSignal.timeout(15_000) },
        },
      );
      if (
        data.permissions?.issues !== "read" ||
        data.permissions?.pull_requests !== "read" ||
        Object.values(data.permissions ?? {}).some((v) => v === "write")
      )
        throw new Error();
      const [owner, repo, ...extra] = target.repositoryFullName.split("/");
      if (!owner || !repo || extra.length) throw new Error();
      return {
        target,
        owner,
        repo,
        headers: { authorization: "Bearer " + data.token },
        request: { signal: AbortSignal.timeout(15_000) },
      };
    } catch {
      throw new ContextToolsAccessFailure(
        "context_github_issues_unavailable",
        503,
      );
    }
  };
  return {
    async assertAvailable(a: ReviewRunAuthorization) {
      await session(a);
    },
    async read(a: ReviewRunAuthorization, issueNumber: number) {
      const s = await session(a);
      try {
        const pr = await request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          {
            owner: s.owner,
            repo: s.repo,
            pull_number: a.pullRequestNumber,
            headers: s.headers,
            request: s.request,
          },
        );
        if (pr.data.head.sha !== a.headSha)
          throw new ContextToolsAccessFailure("context_revision_changed", 410);
        if (
          !linkedIssueNumbers(
            (pr.data.title + "\n" + (pr.data.body ?? "")).slice(0, 65_536),
            s.target.repositoryFullName,
          ).has(issueNumber)
        )
          throw new ContextToolsAccessFailure("context_issue_not_linked", 400);
        const issue = await request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}",
          {
            owner: s.owner,
            repo: s.repo,
            issue_number: issueNumber,
            headers: s.headers,
            request: s.request,
          },
        );
        // Issues endpoint also returns pull requests; this builtin reads issue context only.
        if (issue.data.pull_request)
          throw new ContextToolsAccessFailure("context_issue_not_linked", 400);
        const comments = await request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner: s.owner,
            repo: s.repo,
            issue_number: issueNumber,
            per_page: 20,
            headers: s.headers,
            request: s.request,
          },
        );
        return {
          number: issue.data.number,
          title: issue.data.title.slice(0, 1024),
          body: (issue.data.body ?? "").slice(0, 32768),
          url: issue.data.html_url,
          comments: comments.data.map((c) => ({
            body: (c.body ?? "").slice(0, 8192),
            url: c.html_url,
          })),
        };
      } catch (error) {
        if (error instanceof ContextToolsAccessFailure) throw error;
        throw new ContextToolsAccessFailure(
          "context_github_issues_unavailable",
          503,
        );
      }
    },
  };
}
export function linkedIssueNumbers(
  text: string,
  repository: string,
): Set<number> {
  const ids = new Set<number>();
  for (const match of text.matchAll(/(?:^|[\s(])#([1-9][0-9]{0,9})\b/g))
    ids.add(Number(match[1]));
  for (const match of text.matchAll(
    /https:\/\/github\.com\/([^\s/]+\/[^\s/]+)\/issues\/([1-9][0-9]{0,9})(?=[\s)#?]|$)/g,
  ))
    if (match[1]!.toLowerCase() === repository.toLowerCase())
      ids.add(Number(match[2]));
  return ids;
}
