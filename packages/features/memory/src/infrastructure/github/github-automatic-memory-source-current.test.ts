import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createGitHubAutomaticMemorySourceCurrent } from "./github-automatic-memory-source-current";
import type { MemoryAutomaticSourceCurrentPort } from "../../application/ports/memory-automatic-source-port";

const digest = (body: string) =>
  createHash("sha256").update(body).digest("hex");
function fixture() {
  const updatedAt = "2026-10-28T12:00:00.000Z";
  const comment = (id: number, body: string, replyTo?: number) => ({
    id,
    node_id: `PRRC_${id}`,
    body,
    updated_at: updatedAt,
    ...(replyTo === undefined ? {} : { in_reply_to_id: replyTo }),
    pull_request_url: "https://api.github.com/repos/acme/project/pulls/7",
  });
  const original = [
    comment(100, "Original review finding."),
    comment(101, "Contributor explains the important constraint.", 100),
    comment(102, "Maintainer authorizes learning from this discussion.", 100),
  ];
  let comments = [...original];
  const sourceNode = {
    __typename: "PullRequestReviewComment",
    id: "PRRC_102",
    body: original[2]!.body,
    updatedAt,
    author: { __typename: "User", login: "maintainer", databaseId: 42 },
    pullRequest: {
      number: 7,
      repository: { databaseId: 12, nameWithOwner: "acme/project" },
    },
  };
  const request = vi.fn(
    async (route: string, parameters: Readonly<Record<string, unknown>>) => {
      if (
        route ===
        "GET /repos/{owner}/{repo}/collaborators/{username}/permission"
      )
        return {
          data: {
            permission: "write",
            role_name: "maintain",
            user: { id: 42 },
          },
        };
      if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments") {
        expect(parameters).toMatchObject({
          owner: "acme",
          repo: "project",
          pull_number: 7,
          per_page: 100,
        });
        const start = (Number(parameters.page) - 1) * 100;
        return { data: comments.slice(start, start + 100) };
      }
      throw new Error(`unexpected_route:${route}`);
    },
  );
  const reader = createGitHubAutomaticMemorySourceCurrent({
    scope: {
      workspaceId: "workspace",
      repositoryId: "repository",
      githubRepositoryId: "12",
      repositoryFullName: "acme/project",
    },
    createClient: async () => ({
      request,
      graphql: async () => ({ node: sourceNode }),
    }),
    sourceProcessingAllowed: async () => true,
    standingPolicyRevision: async () => "1:1:qualified",
  });
  const input: Parameters<MemoryAutomaticSourceCurrentPort["current"]>[0] = {
    scope: {
      kind: "repository",
      workspaceId: "workspace",
      repositoryId: "repository",
    },
    source: {
      type: "github_comment",
      sourceId: "github-node:PRRC_102",
      revision: `${updatedAt}:${digest(sourceNode.body)}`,
      updatedAt,
      statementAt: updatedAt,
      repositoryId: "repository",
      pullRequestNumber: 7,
      url: "https://github.com/acme/project/pull/7#discussion_r102",
      visibility: "public",
      claimedBodyDigest: digest(sourceNode.body),
      observedCommitSha: "a".repeat(40),
    },
    binding: {
      policyRevision: "1:1:qualified",
      sourceActorId: "github-user:42",
      observedCommitSha: "a".repeat(40),
      contextEvidence: {
        threadId: "github-review-thread:100",
        messages: original.map((item) => ({
          id: `github-node:${item.node_id}`,
          updatedAt: item.updated_at,
          bodyDigest: digest(item.body),
          replyTo:
            item.in_reply_to_id === undefined
              ? null
              : String(item.in_reply_to_id),
        })),
      },
    },
  };
  return {
    input,
    original,
    request,
    comment,
    sourceNode,
    replace: (next: typeof comments) => {
      comments = next;
    },
    current: (value = input) =>
      reader.current(value, { deadlineAt: new Date(Date.now() + 10_000) }),
  };
}

it.each([
  "body",
  "revision",
  "deleted",
  "foreign_repository",
  "foreign_thread",
] as const)("rejects changed checked-thread evidence: %s", async (change) => {
  const f = fixture();
  const comments = f.original.map((item) => ({ ...item }));
  if (change === "body") comments[1]!.body = "Edited contributor constraint.";
  if (change === "revision")
    comments[1]!.updated_at = "2026-10-28T12:01:00.000Z";
  if (change === "deleted") comments.splice(1, 1);
  if (change === "foreign_repository")
    comments[1]!.pull_request_url =
      "https://api.github.com/repos/acme/other/pulls/7";
  if (change === "foreign_thread") comments[1]!.in_reply_to_id = 999;
  f.replace(comments);
  expect(await f.current()).toBe(false);
});

it("keeps frozen evidence valid after an appended bot reply and reads dependencies across pages", async () => {
  const f = fixture();
  f.replace([
    ...Array.from({ length: 100 }, (_, index) =>
      f.comment(1000 + index, "Unrelated review thread."),
    ),
    ...f.original,
    f.comment(103, "ReviewRouter's later acknowledgement.", 100),
  ]);
  expect(await f.current()).toBe(true);
  expect(
    f.request.mock.calls.filter(([route]) => route.includes("pull_number")),
  ).toHaveLength(2);
});

it("does not borrow a valid source comment from another repository", async () => {
  const f = fixture();
  f.sourceNode.pullRequest.repository = {
    databaseId: 13,
    nameWithOwner: "acme/other",
  };
  expect(await f.current()).toBe(false);
  expect(f.request).not.toHaveBeenCalled();
});

it("keeps legacy source-only cohorts within their original evidence boundary", async () => {
  const f = fixture();
  const { contextEvidence: _contextEvidence, ...binding } = f.input.binding;
  void _contextEvidence;
  f.replace([]);
  expect(await f.current({ ...f.input, binding })).toBe(true);
  expect(f.request).toHaveBeenCalledTimes(1);
});
