import { describe, expect, it, vi } from "vitest";
import { InMemoryLock } from "@reviewrouter/platform-locks";
import { OctokitCertifiedForkCommentPublisher } from "./octokit-certified-fork-comment-publisher.js";

const marker = "<!-- reviewrouter:certified-fork:v1 repository_id=99 pr=42 -->";

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
        const page = Number(parameters?.page ?? 1);
        const perPage = Number(parameters?.per_page ?? 100);
        return { data: comments.slice((page - 1) * perPage, page * perPage) };
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
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
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
    expect(f.request.mock.calls[3]?.[0]).toBe(
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    );
    expect(f.request.mock.calls[3]?.[1]).toMatchObject({ comment_id: 9 });
  });

  it("migrates the newest App-owned per-head marker in place", async () => {
    const legacy = (id: number) => ({
      id,
      body:
        `<!-- reviewrouter:certified-fork:v1 repository_id=99 pr=42 ` +
        `head_sha=${String(id).padStart(40, "a")} context_hash=${"c".repeat(64)} -->\nold`,
      user: { login: "reviewrouter[bot]" },
    });
    const f = fixture([legacy(9), legacy(10)]);

    await expect(f.publisher.upsert(f.input)).resolves.toMatchObject({
      commentId: "456",
    });
    expect(f.request.mock.calls[3]?.[1]).toMatchObject({ comment_id: 10 });
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

  it("finds an owned marker on a full third inventory page", async () => {
    const comments = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      body: index === 250 ? `${marker}\nold` : `ordinary comment ${index + 1}`,
      user: { login: index === 250 ? "reviewrouter[bot]" : "contributor" },
    }));
    const f = fixture(comments);

    await expect(f.publisher.upsert(f.input)).resolves.toMatchObject({
      commentId: "456",
    });
    expect(
      f.request.mock.calls.filter(([route]) => route.startsWith("PATCH ")),
    ).toHaveLength(1);
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

  it("rechecks the PR head immediately before writing", async () => {
    const f = fixture();
    const current = {
      number: 42,
      state: "open",
      draft: false,
      merged: false,
      base: { sha: "a".repeat(40), repo: { id: 99 } },
      head: { sha: "b".repeat(40), repo: { id: 101 } },
    };
    f.request
      .mockResolvedValueOnce({ data: current })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: {
          ...current,
          head: { sha: "d".repeat(40), repo: { id: 101 } },
        },
      });

    await expect(f.publisher.upsert(f.input)).rejects.toThrow(
      "certified_fork_comment_pull_request_stale",
    );
    expect(
      f.request.mock.calls.some(([route]) => route.startsWith("POST ")),
    ).toBe(false);
  });

  it("serializes concurrent upserts for the same certified marker", async () => {
    let releaseInventory!: () => void;
    let markInventoryStarted!: () => void;
    const inventoryStarted = new Promise<void>(
      (resolve) => (markInventoryStarted = resolve),
    );
    let published = false;
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
        if (!published) {
          await new Promise<void>((resolve) => (releaseInventory = resolve));
        }
        return {
          data: published
            ? [
                {
                  id: 123,
                  body: `${marker}\nReview result`,
                  user: { login: "reviewrouter[bot]" },
                },
              ]
            : [],
        };
      }
      if (route.startsWith("POST ")) published = true;
      return { data: { id: 123 } };
    });
    const publisher = new OctokitCertifiedForkCommentPublisher({
      appSlug: "reviewrouter",
      app: { getInstallationOctokit: () => ({ request }) },
      lock: new InMemoryLock(),
    });
    const first = publisher.upsert(fixture().input);
    await inventoryStarted;
    const second = publisher.upsert(fixture().input);
    releaseInventory();
    await expect(first).resolves.toMatchObject({ commentId: "123" });
    await expect(second).resolves.toMatchObject({ commentId: "123" });
    expect(
      request.mock.calls.filter(([route]) => route.startsWith("POST ")),
    ).toHaveLength(1);
  });
});
