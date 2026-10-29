import { vi } from "vitest";
import type { FakeGitHubTransport } from "../../review-action-v2-production-e2e/support/fake-github.js";
import { publishedReviewCommentTimestamps } from "./review-comment-fixture.js";

/** Synthetic GitHub observations; mutations are issued by the real App gateway. */
export function installComparisonThreadBoundary(github: FakeGitHubTransport) {
  const threadId = "paired-comparison-thread";
  let parent: Record<string, unknown> | undefined;
  let path = "";
  let isResolved = false;
  let resolveCalls = 0;
  const original = github.fetch;
  vi.spyOn(github, "fetch").mockImplementation(async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    const pathname = new URL(request.url).pathname;
    const requireAppToken = () => {
      if (
        !/^(?:token|Bearer) fake-installation-token$/u.test(
          request.headers.get("authorization") ?? "",
        )
      ) {
        throw new Error("paired_publication_requires_configured_app_token");
      }
    };
    if (
      (request.method === "POST" && pathname.endsWith("/issues/42/comments")) ||
      (request.method === "PATCH" && pathname.includes("/issues/comments/"))
    )
      requireAppToken();
    if (pathname === "/graphql") {
      const body = (await request.clone().json()) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const query = body.query;
      if (query.includes("ReviewRouterResolveThread")) {
        requireAppToken();
        if (!parent || body.variables.id !== threadId)
          throw new Error("paired_resolve_identity_invalid");
        resolveCalls += 1;
        isResolved = true;
        return Response.json({
          data: {
            resolveReviewThread: { thread: { id: threadId, isResolved } },
          },
        });
      }
      if (query.includes("ReviewRouterPublicationThread")) {
        return Response.json({
          data: {
            node: parent
              ? {
                  id: threadId,
                  isResolved,
                  pullRequest: {
                    number: 42,
                    repository: {
                      nameWithOwner: "reviewrouter-e2e/disposable-review-v2",
                    },
                  },
                }
              : null,
          },
        });
      }
      if (
        query.includes("ReviewRouterThreadInventory") ||
        query.includes("ReviewRouterPublicationLifecycle")
      ) {
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                headRefOid: github.revision.headSha,
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: parent
                    ? [
                        {
                          id: threadId,
                          isResolved,
                          isOutdated: false,
                          viewerCanResolve: true,
                          path,
                          line: 1,
                          originalLine: 1,
                          comments: {
                            pageInfo: { hasNextPage: false, endCursor: null },
                            nodes: [parent],
                          },
                        },
                      ]
                    : [],
                },
              },
            },
          },
        });
      }
    }
    return original(input, init);
  });
  return {
    threadId,
    get isResolved() {
      return isResolved;
    },
    get resolveCalls() {
      return resolveCalls;
    },
    observeActive(lineageId: string, filePath: string) {
      path = filePath;
      parent = {
        id: "paired-comparison-parent",
        databaseId: 789,
        viewerDidAuthor: true,
        author: { login: "reviewrouter-e2e[bot]", __typename: "Bot" },
        body: `<!-- reviewrouter:finding:v2:${lineageId} -->\n### Original unsafe return\n**Severity: major**\nThe unsafe return permits an incorrect runtime result.`,
        ...publishedReviewCommentTimestamps("2026-01-01T00:00:00Z"),
        path,
        line: 1,
        originalLine: 1,
      };
    },
  };
}
