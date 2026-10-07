import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { HostedV4ReadScope } from "@reviewrouter/features-hosted-account-pool";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import { HostedV4ScmReadGateway } from "./hosted-v4-scm-read-gateway.js";

const request = vi.hoisted(() => vi.fn());
vi.mock("@octokit/request", () => ({ request }));

const scope: HostedV4ReadScope = {
  authorizationId: "authorization-1",
  repositoryConnectionId: "repository-1",
  githubRepositoryId: "123",
  githubInstallationId: "456",
  owner: "owner",
  repo: "repo",
  pullRequestNumber: 7,
  providerInstanceId: "hosted-pool:repository:123",
  bindingId: "binding-1",
  bindingVersion: 2,
  headSha: "a".repeat(40),
  reviewRevisionHash: "revision-1",
  producerReleaseId: "release-1",
  expiresAt: "2026-09-24T12:05:00.000Z",
};

describe("hosted v4 SCM read gateway", () => {
  beforeEach(() => request.mockReset());

  function gateway() {
    const issueContentsReadToken = vi.fn(async () => ({
      token: "server-only-bearer",
      expiresAt: new Date("2026-09-24T12:10:00.000Z"),
      permissions: { contents: "read" as const, pullRequests: "read" as const },
    }));
    return {
      gateway: new HostedV4ScmReadGateway(
        { issueContentsReadToken },
        () => new Date("2026-09-24T12:00:00.000Z"),
      ),
      issueContentsReadToken,
    };
  }

  // A missing repository-ID check would read a renamed or substituted repo.
  it("checks repository identity before reading the pinned head", async () => {
    const f = gateway();
    request.mockResolvedValueOnce({ data: { id: 999 } });
    await expect(f.gateway.readFile(scope, "src/index.ts")).rejects.toThrow(
      "hosted_v4_scm_read_denied",
    );
    expect(request).toHaveBeenCalledTimes(1);

    request.mockReset();
    request.mockResolvedValueOnce({ data: { id: 123 } });
    request.mockResolvedValueOnce({
      data: {
        type: "file",
        encoding: "base64",
        content: Buffer.from("hello").toString("base64"),
        size: 5,
        sha: "b".repeat(40),
      },
    });
    await expect(f.gateway.readFile(scope, "src/index.ts")).resolves.toEqual({
      path: "src/index.ts",
      headSha: scope.headSha,
      blobSha: "b".repeat(40),
      contentBase64: Buffer.from("hello").toString("base64"),
    });
    expect(f.issueContentsReadToken).toHaveBeenCalledWith({
      githubInstallationId: "456",
      githubRepositoryId: "123",
      repositoryFullName: "owner/repo",
    });
    expect(request).toHaveBeenLastCalledWith(
      "GET /repos/{owner}/{repo}/contents/{path}",
      expect.objectContaining({ path: "src/index.ts", ref: scope.headSha }),
    );
  });

  // An overprivileged token result must never authorize even a read request.
  it("rejects a token result with an extra permission", async () => {
    const issuer = {
      issueContentsReadToken: async () => ({
        token: "write-bearer",
        expiresAt: new Date("2026-09-24T12:10:00.000Z"),
        permissions: {
          contents: "read" as const,
          pullRequests: "read" as const,
          issues: "write",
        },
      }),
    };
    const gateway = new HostedV4ScmReadGateway(
      issuer,
      () => new Date("2026-09-24T12:00:00.000Z"),
    );
    await expect(gateway.readFile(scope, "src/index.ts")).rejects.toThrow(
      "hosted_v4_scm_read_denied",
    );
    expect(request).not.toHaveBeenCalled();
  });

  // A PR number in another repository must not become this repository's read authority.
  it("rejects a PR whose base repository ID differs from the binding", async () => {
    const f = gateway();
    request.mockResolvedValueOnce({ data: { id: 123 } });
    request.mockResolvedValueOnce({
      data: {
        number: 7,
        state: "open",
        base: { sha: "c".repeat(40), repo: { id: 999 } },
        head: { sha: scope.headSha },
      },
    });
    await expect(
      f.gateway.readPullRequestAuthority({
        githubInstallationId: scope.githubInstallationId,
        githubRepositoryId: scope.githubRepositoryId,
        owner: scope.owner,
        repo: scope.repo,
        pullRequestNumber: scope.pullRequestNumber,
      }),
    ).resolves.toBeNull();
  });

  // A different revision digest would let v4 accept a head that v2 did not authorize.
  it("uses the v2 canonical revision digest after two matching PR reads", async () => {
    const f = gateway();
    const baseSha = "c".repeat(40);
    const mergeBaseSha = "d".repeat(40);
    const pr = {
      number: 7,
      state: "open",
      base: { sha: baseSha, repo: { id: 123 } },
      head: { sha: scope.headSha },
    };
    request
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({ data: pr })
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({
        data: { merge_base_commit: { sha: mergeBaseSha } },
      })
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({ data: pr });
    const expected = createHash("sha256")
      .update(
        canonicalJson({
          workspaceId: "workspace-1",
          repositoryConnectionId: scope.repositoryConnectionId,
          scmRepositoryIdentityId: "scm-1",
          pullRequestNumber: 7,
          baseSha,
          mergeBaseSha,
          headSha: scope.headSha,
        }),
      )
      .digest("hex");
    await expect(
      f.gateway.readCanonicalRevision({
        workspaceId: "workspace-1",
        repositoryConnectionId: scope.repositoryConnectionId,
        scmRepositoryIdentityId: "scm-1",
        githubInstallationId: scope.githubInstallationId,
        githubRepositoryId: scope.githubRepositoryId,
        owner: scope.owner,
        repo: scope.repo,
        pullRequestNumber: 7,
      }),
    ).resolves.toEqual({
      pullRequestNumber: 7,
      headSha: scope.headSha,
      reviewRevisionHash: expected,
    });
    expect(request).toHaveBeenCalledTimes(6);
  });

  // A head move during merge-base lookup must not mint a stale revision hash.
  it("rejects a PR head move between its two observations", async () => {
    const f = gateway();
    const pr = {
      number: 7,
      state: "open",
      base: { sha: "c".repeat(40), repo: { id: 123 } },
      head: { sha: scope.headSha },
    };
    request
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({ data: pr })
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({
        data: { merge_base_commit: { sha: "d".repeat(40) } },
      })
      .mockResolvedValueOnce({ data: { id: 123 } })
      .mockResolvedValueOnce({
        data: { ...pr, head: { sha: "e".repeat(40) } },
      });
    await expect(
      f.gateway.readCanonicalRevision({
        workspaceId: "workspace-1",
        repositoryConnectionId: scope.repositoryConnectionId,
        scmRepositoryIdentityId: "scm-1",
        githubInstallationId: scope.githubInstallationId,
        githubRepositoryId: scope.githubRepositoryId,
        owner: scope.owner,
        repo: scope.repo,
        pullRequestNumber: 7,
      }),
    ).resolves.toBeNull();
  });
});
