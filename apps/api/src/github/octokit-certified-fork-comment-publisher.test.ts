import { describe, expect, it, vi } from "vitest";
import { InMemoryLock } from "@reviewrouter/platform-locks";
import { OctokitCertifiedForkCommentPublisher } from "./octokit-certified-fork-comment-publisher.js";

const marker =
  `<!-- reviewrouter:certified-fork:v1 repository_id=99 pr=42 ` +
  `head_sha=${"b".repeat(40)} context_hash=${"c".repeat(64)} -->`;

function fixture(comments: unknown[] = []) {
  const request = vi.fn(
    async (route: string, parameters?: Record<string, unknown>) => {
      void parameters;
      if (route.endsWith("/pulls/{pull_number}")) {
        return {
          data: {
            number: 42,
            state: "open",
            draft: false,
            merged: false,
            base: { sha: "a".repeat(40), repo: { id: 99 } },
            head: { sha: "b".repeat(40), repo: { id: 101 } },
          },
        };
      }
      if (route.startsWith("GET ") && route.includes("/comments")) {
        return { data: comments };
      }
      return {
        data: {
          id: route.startsWith("POST ") ? 123 : 456,
          html_url: "https://github.test/comment",
        },
      };
    },
  );
  const publisher = new OctokitCertifiedForkCommentPublisher({
    appSlug: "reviewrouter",
    app: { getInstallationOctokit: () => ({ request }) },
    lock: new InMemoryLock(),
  });
  const input = {
    githubInstallationId: "7",
    repositoryFullName: "owner/example",
    baseRepositoryId: "99",
    sourceRepositoryId: "101",
    pullRequestNumber: 42,
    baseSha: "a".repeat(40),
    reviewHeadSha: "b".repeat(40),
    marker,
    body: `${marker}\nReview result`,
  };
  return { input, publisher, request };
}

describe("certified fork App comment publisher", () => {
  it("posts once when no owned marker exists", async () => {
    const f = fixture([
      {
        id: 1,
        body: `${marker}\nattacker copy`,
        user: { login: "attacker" },
      },
    ]);
    await expect(f.publisher.upsert(f.input)).resolves.toEqual({
      commentId: "123",
      url: "https://github.test/comment",
    });
    expect(f.request.mock.calls.map(([route]) => route)).toEqual([
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    ]);
    for (const [, parameters] of f.request.mock.calls) {
      expect(parameters).toMatchObject({ request: { timeout: 15_000 } });
    }
  });

  it("patches the single App-owned marker", async () => {
    const f = fixture([
      {
        id: 9,
        body: `${marker}\nold`,
        user: { login: "ReviewRouter[bot]" },
      },
    ]);
    await expect(f.publisher.upsert(f.input)).resolves.toMatchObject({
      commentId: "456",
    });
    expect(f.request.mock.calls[2]?.[0]).toBe(
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    );
    expect(f.request.mock.calls[2]?.[1]).toMatchObject({ comment_id: 9 });
  });

  it("fails closed for duplicate App-owned markers", async () => {
    const comment = {
      id: 9,
      body: `${marker}\nold`,
      user: { login: "reviewrouter[bot]" },
    };
    const f = fixture([comment, { ...comment, id: 10 }]);
    await expect(f.publisher.upsert(f.input)).rejects.toThrow(
      "certified_fork_comment_marker_ambiguous",
    );
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it("does not inventory or publish when the PR head is stale", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      data: {
        number: 42,
        state: "open",
        draft: false,
        merged: false,
        base: { sha: "a".repeat(40), repo: { id: 99 } },
        head: { sha: "d".repeat(40), repo: { id: 101 } },
      },
    });
    await expect(f.publisher.upsert(f.input)).rejects.toThrow(
      "certified_fork_comment_pull_request_stale",
    );
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent upserts for the same certified marker", async () => {
    let releaseInventory!: () => void;
    let markInventoryStarted!: () => void;
    const inventoryStarted = new Promise<void>(
      (resolve) => (markInventoryStarted = resolve),
    );
    const request = vi.fn(async (route: string): Promise<{ data: unknown }> => {
      if (route.endsWith("/pulls/{pull_number}")) {
        return {
          data: {
            number: 42,
            state: "open",
            draft: false,
            merged: false,
            base: { sha: "a".repeat(40), repo: { id: 99 } },
            head: { sha: "b".repeat(40), repo: { id: 101 } },
          },
        };
      }
      if (route.startsWith("GET ")) {
        markInventoryStarted();
        await new Promise<void>((resolve) => (releaseInventory = resolve));
        return { data: [] };
      }
      return { data: { id: 123 } };
    });
    const publisher = new OctokitCertifiedForkCommentPublisher({
      appSlug: "reviewrouter",
      app: { getInstallationOctokit: () => ({ request }) },
      lock: new InMemoryLock(),
    });
    const first = publisher.upsert(fixture().input);
    await inventoryStarted;
    await expect(publisher.upsert(fixture().input)).rejects.toThrow(
      "Lock already held",
    );
    releaseInventory();
    await expect(first).resolves.toMatchObject({ commentId: "123" });
    expect(
      request.mock.calls.filter(([route]) => route.startsWith("POST ")),
    ).toHaveLength(1);
  });
});
