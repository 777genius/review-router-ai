import { describe, expect, it, vi } from "vitest";
import { postPullRequestComment } from "./github-comment-publication";

const publication = {
  token: "test-comment-token",
  owner: "example",
  repo: "repository",
  issueNumber: 42,
  marker: "<!-- reviewrouter:test -->",
  body: "<!-- reviewrouter:test -->\nA completed review",
};

describe("GitHub Action comment publication", () => {
  it("never replays a committed create with a lost response and reconciles the marker on the next invocation", async () => {
    const stored: { id: number; body: string }[] = [];
    const methods: string[] = [];
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        if (method === "GET") {
          return Response.json(stored);
        }
        if (method === "POST") {
          stored.push({
            id: 123,
            body: JSON.parse(String(init?.body)).body as string,
          });
          throw new Error("connection_reset_after_commit");
        }
        if (method === "PATCH") {
          return new Response(null, { status: 204 });
        }
        throw new Error("unexpected_request");
      },
    );

    await expect(
      postPullRequestComment({
        ...publication,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("network_request_failed:github_comment_create");
    expect(methods).toEqual(["GET", "POST"]);
    expect(stored).toHaveLength(1);

    await postPullRequestComment({
      ...publication,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(methods).toEqual(["GET", "POST", "GET", "PATCH"]);
    expect(stored).toHaveLength(1);
  });

  it("does not replay a retryable HTTP status from a non-idempotent create", async () => {
    const methods: string[] = [];
    const unavailable = new Response("upstream unavailable", { status: 503 });
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        return method === "POST" ? unavailable : Response.json([]);
      },
    );

    await expect(
      postPullRequestComment({
        ...publication,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("github_comment_post_failed");
    expect(methods).toEqual(["GET", "POST"]);
    expect(unavailable.bodyUsed).toBe(true);
  });
});
