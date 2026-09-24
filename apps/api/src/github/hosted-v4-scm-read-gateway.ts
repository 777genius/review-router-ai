import { request as githubRequest } from "@octokit/request";
import { createHash } from "node:crypto";
import type { HostedV4ReadScope } from "@reviewrouter/features-hosted-account-pool";
import { canonicalJson } from "@reviewrouter/features-review-run-control";

export interface HostedV4RepositoryReadTokenIssuer {
  issueContentsReadToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
    readonly permissions: {
      readonly contents: "read";
      readonly pullRequests: "read";
    };
  }>;
}

/** The GitHub bearer stays inside this adapter and is never a route result. */
export class HostedV4ScmReadGateway {
  constructor(
    private readonly tokens: HostedV4RepositoryReadTokenIssuer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readFile(scope: HostedV4ReadScope, path: string) {
    if (
      !/^[a-f0-9]{40}$/u.test(scope.headSha) ||
      !/^[1-9][0-9]*$/u.test(scope.githubRepositoryId) ||
      !/^[1-9][0-9]*$/u.test(scope.githubInstallationId) ||
      !/^[A-Za-z0-9_.-]+$/u.test(scope.owner) ||
      !/^[A-Za-z0-9_.-]+$/u.test(scope.repo) ||
      !validPath(path)
    ) {
      throw new Error("hosted_v4_scm_read_denied");
    }
    const token = await this.mintReadToken(scope);
    const headers = { authorization: `Bearer ${token}` };
    await this.assertRepositoryIdentity(scope, headers);
    const response = await githubRequest(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: scope.owner,
        repo: scope.repo,
        path,
        ref: scope.headSha,
        headers,
      },
    );
    const file = response.data as {
      type?: unknown;
      encoding?: unknown;
      content?: unknown;
      sha?: unknown;
      size?: unknown;
    };
    if (
      !file ||
      Array.isArray(file) ||
      file.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string" ||
      typeof file.sha !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(file.sha) ||
      !Number.isSafeInteger(file.size) ||
      (file.size as number) < 0 ||
      (file.size as number) > 1_000_000
    ) {
      throw new Error("hosted_v4_scm_read_denied");
    }
    const encoded = file.content.replace(/\s/gu, "");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        encoded,
      )
    ) {
      throw new Error("hosted_v4_scm_read_denied");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== file.size || bytes.toString("base64") !== encoded) {
      throw new Error("hosted_v4_scm_read_denied");
    }
    return {
      path,
      headSha: scope.headSha,
      blobSha: file.sha,
      contentBase64: encoded,
    };
  }

  async readPullRequestAuthority(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
    readonly pullRequestNumber: number;
  }): Promise<{ readonly baseSha: string; readonly headSha: string } | null> {
    if (
      !Number.isSafeInteger(input.pullRequestNumber) ||
      input.pullRequestNumber < 1
    )
      throw new Error("hosted_v4_scm_read_denied");
    const token = await this.mintReadToken(input);
    const headers = { authorization: `Bearer ${token}` };
    await this.assertRepositoryIdentity(input, headers);
    const response = await githubRequest(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullRequestNumber,
        headers,
      },
    );
    const pr = response.data as {
      number?: unknown;
      state?: unknown;
      base?: { sha?: unknown; repo?: { id?: unknown } };
      head?: { sha?: unknown };
    };
    const baseSha = pr?.base?.sha;
    const headSha = pr?.head?.sha;
    if (
      !pr ||
      pr.number !== input.pullRequestNumber ||
      pr.state !== "open" ||
      String(pr.base?.repo?.id ?? "") !== input.githubRepositoryId ||
      typeof baseSha !== "string" ||
      !/^[a-f0-9]{40}$/u.test(baseSha) ||
      typeof headSha !== "string" ||
      !/^[a-f0-9]{40}$/u.test(headSha)
    )
      return null;
    return { baseSha, headSha };
  }

  /** Mirrors the v2 canonical revision fields using only a scoped read token. */
  async readCanonicalRevision(input: {
    readonly workspaceId: string;
    readonly repositoryConnectionId: string;
    readonly scmRepositoryIdentityId: string;
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
    readonly pullRequestNumber: number;
  }) {
    const before = await this.readPullRequestAuthority(input);
    if (!before) return null;
    const mergeBaseSha = await this.readMergeBaseSha({ ...input, ...before });
    if (!mergeBaseSha) return null;
    const after = await this.readPullRequestAuthority(input);
    if (
      !after ||
      after.baseSha !== before.baseSha ||
      after.headSha !== before.headSha
    )
      return null;
    const reviewRevisionHash = createHash("sha256")
      .update(
        canonicalJson({
          workspaceId: input.workspaceId,
          repositoryConnectionId: input.repositoryConnectionId,
          scmRepositoryIdentityId: input.scmRepositoryIdentityId,
          pullRequestNumber: input.pullRequestNumber,
          baseSha: before.baseSha,
          mergeBaseSha,
          headSha: before.headSha,
        }),
      )
      .digest("hex");
    return {
      pullRequestNumber: input.pullRequestNumber,
      headSha: before.headSha,
      reviewRevisionHash,
    };
  }

  private async readMergeBaseSha(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
    readonly baseSha: string;
    readonly headSha: string;
  }): Promise<string | null> {
    const token = await this.mintReadToken(input);
    const headers = { authorization: `Bearer ${token}` };
    await this.assertRepositoryIdentity(input, headers);
    const response = await githubRequest(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner: input.owner,
        repo: input.repo,
        basehead: `${input.baseSha}...${input.headSha}`,
        headers,
      },
    );
    const sha = (response.data as { merge_base_commit?: { sha?: unknown } })
      .merge_base_commit?.sha;
    return typeof sha === "string" && /^[a-f0-9]{40}$/u.test(sha) ? sha : null;
  }

  private async mintReadToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
  }): Promise<string> {
    if (
      !/^[1-9][0-9]*$/u.test(input.githubRepositoryId) ||
      !/^[1-9][0-9]*$/u.test(input.githubInstallationId) ||
      !/^[A-Za-z0-9_.-]+$/u.test(input.owner) ||
      !/^[A-Za-z0-9_.-]+$/u.test(input.repo)
    )
      throw new Error("hosted_v4_scm_read_denied");
    const token = await this.tokens.issueContentsReadToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      repositoryFullName: `${input.owner}/${input.repo}`,
    });
    if (
      !token.token ||
      !(token.expiresAt instanceof Date) ||
      token.expiresAt <= this.now() ||
      token.permissions.contents !== "read" ||
      token.permissions.pullRequests !== "read" ||
      Object.keys(token.permissions).length !== 2
    ) {
      throw new Error("hosted_v4_scm_read_denied");
    }
    return token.token;
  }

  private async assertRepositoryIdentity(
    input: {
      readonly githubRepositoryId: string;
      readonly owner: string;
      readonly repo: string;
    },
    headers: { readonly authorization: string },
  ): Promise<void> {
    const repository = await githubRequest("GET /repos/{owner}/{repo}", {
      owner: input.owner,
      repo: input.repo,
      headers,
    });
    if (
      String((repository.data as { id?: unknown }).id) !==
      input.githubRepositoryId
    ) {
      throw new Error("hosted_v4_scm_read_denied");
    }
  }
}

function validPath(path: string): boolean {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..") &&
    Array.from(path).every((character) => {
      const code = character.charCodeAt(0);
      return (
        character !== "\\" && character !== "%" && code >= 0x20 && code !== 0x7f
      );
    })
  );
}
