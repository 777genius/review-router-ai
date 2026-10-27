import type { PrismaClient } from "@prisma/client";
import type { ActionSessionClaims } from "@reviewrouter/features-action-control-plane";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubMemorySourceVerifier,
  githubMemorySourceSchema,
  memorySourceMetadataQuery,
} from "./github-memory-source-verifier";

const session: ActionSessionClaims = {
  workspaceId: "workspace_1",
  repositoryId: "repo_1",
  githubRepositoryId: "1234",
  repository: "acme/project",
  githubActorLogin: "maintainer",
  githubActorId: "11",
  githubRunId: "run_1",
  githubRunAttempt: "1",
  eventName: "issue_comment",
  protocolVersion: 1,
  pullRequestNumber: 7,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
};
const claim = githubMemorySourceSchema.parse({
  type: "github_issue_comment",
  sourceId: "github-comment:77",
  nodeId: "IC_fixture_77",
  revision: "2026-10-23T10:00:00Z",
  updatedAt: "2026-10-23T10:00:00Z",
  statementAt: "2026-10-23T10:00:00Z",
  claimedBodyDigest: "c".repeat(64),
  githubRepositoryId: "1234",
  pullRequestNumber: 7,
  headSha: session.headSha,
  baseSha: session.baseSha,
  visibility: "public",
  url: "https://evil.test/untrusted-claim",
});
const metadata = {
  __typename: "IssueComment",
  id: claim.nodeId,
  updatedAt: claim.updatedAt,
  createdAt: "2026-10-23T09:00:00Z",
  url: "https://github.com/acme/project/pull/7#issuecomment-77",
  author: { __typename: "User", databaseId: 11, login: "maintainer" },
  pullRequest: {
    number: 7,
    headRefOid: session.headSha,
    baseRefOid: session.baseSha,
    repository: {
      databaseId: 1234,
      nameWithOwner: "acme/project",
      visibility: "PRIVATE",
    },
  },
};
const controls = () => ({ deadlineAt: new Date(Date.now() + 3_000) });
function fixture(node: unknown = metadata) {
  const repository = {
    githubRepositoryId: 1234n,
    fullName: "acme/project",
    visibility: "private",
    installation: { githubInstallationId: 55n, status: "active" },
  };
  const findFirst = vi.fn(async () => repository);
  const graphql = vi.fn(async () => ({ node }));
  const request = vi.fn();
  const createClient = vi.fn(async () => ({ graphql, request }));
  const verifier = new GitHubMemorySourceVerifier({
    prisma: { repositoryConnection: { findFirst } } as unknown as PrismaClient,
    env: {},
    createClient: createClient as never,
  });
  return { verifier, graphql, request, createClient, findFirst, repository };
}
describe("independent metadata-only GitHub source critic", () => {
  it("uses one node query with no raw comment,code,PR body or thread field and derives stable author/repository metadata", async () => {
    const f = fixture();
    const result = await f.verifier.verify(session, claim, controls());
    expect(f.graphql).toHaveBeenCalledExactlyOnceWith(
      memorySourceMetadataQuery,
      expect.objectContaining({ nodeId: claim.nodeId }),
    );
    expect(memorySourceMetadataQuery).not.toMatch(
      /\b(?:body|bodyText|bodyHTML|diffHunk|path|thread|title)\b/,
    );
    expect(f.request).not.toHaveBeenCalled();
    expect(f.createClient).toHaveBeenCalledWith("55");
    expect(result.actor).toEqual({
      kind: "github_user",
      id: "github-user:11",
      githubUserId: "11",
      login: "maintainer",
    });
    expect(result.source).toMatchObject({
      type: "github_comment",
      sourceId: "github-node:IC_fixture_77",
      repositoryId: "repo_1",
      url: metadata.url,
      visibility: "private",
    });
    expect(result.source.url).not.toBe(claim.url);
    expect(result.source.visibility).not.toBe(claim.visibility);
  });
  it.each([
    null,
    { ...metadata, id: "IC_other" },
    { ...metadata, __typename: "PullRequestReviewComment" },
    { ...metadata, author: null },
    { ...metadata, author: { ...metadata.author, __typename: "Bot" } },
    { ...metadata, author: { ...metadata.author, databaseId: null } },
    { ...metadata, author: { ...metadata.author, login: "someone-else" } },
    { ...metadata, pullRequest: null },
    { ...metadata, pullRequest: { ...metadata.pullRequest, number: 8 } },
    {
      ...metadata,
      pullRequest: { ...metadata.pullRequest, headRefOid: "f".repeat(40) },
    },
    {
      ...metadata,
      pullRequest: { ...metadata.pullRequest, baseRefOid: "f".repeat(40) },
    },
    {
      ...metadata,
      pullRequest: {
        ...metadata.pullRequest,
        repository: { ...metadata.pullRequest.repository, databaseId: 9999 },
      },
    },
    {
      ...metadata,
      pullRequest: {
        ...metadata.pullRequest,
        repository: {
          ...metadata.pullRequest.repository,
          nameWithOwner: "other/project",
        },
      },
    },
    { ...metadata, updatedAt: "2026-10-23T11:00:00Z" },
  ])(
    "fails closed on source/actor/revision/repository mismatch %o",
    async (node) => {
      await expect(
        fixture(node).verifier.verify(session, claim, controls()),
      ).rejects.toMatchObject({ code: "conflict" });
    },
  );
  it("rejects a reassigned matching login when signed numeric actor ID differs, and fails legacy memory writes closed", async () => {
    const f = fixture();
    await expect(
      f.verifier.verify({ ...session, githubActorId: "22" }, claim, controls()),
    ).rejects.toMatchObject({ code: "conflict" });
    const legacy = { ...session };
    delete legacy.githubActorId;
    await expect(
      f.verifier.verify(legacy, claim, controls()),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.graphql).toHaveBeenCalledTimes(1);
  });
  it.each([
    { githubRepositoryId: "9999" },
    { githubActorLogin: null },
    { eventName: "pull_request" },
    { pullRequestNumber: 8 },
    { headSha: "f".repeat(40) },
    { baseSha: "f".repeat(40) },
  ])(
    "rejects a session mismatch before external source I/O %o",
    async (change) => {
      const f = fixture();
      await expect(
        f.verifier.verify(
          { ...session, ...change } as ActionSessionClaims,
          claim,
          controls(),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(f.graphql).not.toHaveBeenCalled();
    },
  );
  it("accepts review comments only for the matching signed event", async () => {
    const f = fixture({ ...metadata, __typename: "PullRequestReviewComment" });
    expect(
      (
        await f.verifier.verify(
          { ...session, eventName: "pull_request_review_comment" },
          { ...claim, type: "github_review_comment" },
          controls(),
        )
      ).source.type,
    ).toBe("github_comment");
    await expect(
      f.verifier.verify(
        session,
        { ...claim, type: "github_review_comment" },
        controls(),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rejects inactive/deselected repository and never falls back to REST raw bodies", async () => {
    const f = fixture();
    f.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      f.verifier.verify(session, claim, controls()),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.graphql).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each([
    "https://evil.test/acme/project/pull/7",
    "http://github.com/acme/project/pull/7",
    "https://github.com/acme/project/pull/8",
    "https://github.com/acme/project/pull/7?body=secret",
  ])("rejects unsafe upstream provenance URL %s", async (url) => {
    await expect(
      fixture({ ...metadata, url }).verifier.verify(session, claim, controls()),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("sanitizes provider failures and honors preflight deadline/cancellation", async () => {
    const f = fixture();
    f.graphql.mockRejectedValueOnce(new Error("PRIVATE BODY AND SERVICE KEY"));
    await expect(
      f.verifier.verify(session, claim, controls()),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "memory_unavailable",
    });
    f.graphql.mockClear();
    await expect(
      f.verifier.verify(session, claim, { deadlineAt: new Date(0) }),
    ).rejects.toMatchObject({ code: "deadline_exceeded" });
    await expect(
      f.verifier.verify(session, claim, {
        ...controls(),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(f.graphql).not.toHaveBeenCalled();
  });
});
