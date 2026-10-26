import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { encryptServerToken } from "@reviewrouter/features-auth";
import {
  PrismaGitHubUserReviewThreadResolver,
  legacyResolutionWriterSourceIdentity,
  legacyResolutionWriterSourceVersion,
} from "./prisma-github-user-review-thread-resolver.js";

const env = {
  REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef",
  GITHUB_APP_SLUG: "review-router-ai",
};

const resolutionHistory = {
  enterLegacy: vi
    .fn()
    .mockResolvedValue({ scope: {}, operationId: "test-entry" }),
  settleLegacy: vi.fn().mockResolvedValue(undefined),
};

const now = new Date("2026-05-14T12:00:00.000Z");

function createPrismaMock() {
  return {
    repositoryPermissionCache: {
      findMany: vi.fn().mockResolvedValue([{ userId: "user_1" }]),
    },
    workspaceMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    gitHubUserAuthorization: {
      findUnique: vi.fn().mockResolvedValue({
        encryptedAccessToken: encryptServerToken("ghu_user_token", env),
        encryptedRefreshToken: null,
        accessTokenExpiresAt: new Date("2026-05-14T13:00:00.000Z"),
        refreshTokenExpiresAt: null,
        revokedAt: null,
        lastErrorCode: null,
      }),
    },
  } as unknown as PrismaClient;
}

function request() {
  return {
    repository: {
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      githubRepositoryId: "123",
      githubInstallationId: "456",
      fullName: "777genius/example",
      owner: "777genius",
      selected: true,
      installationStatus: "active",
    },
    request: {
      protocolVersion: 1 as const,
      pullRequestNumber: 109,
      reviewedHeadSha: "a".repeat(40),
      target: {
        targetId: "rrt_123",
        threadId: "thread-123",
        fingerprint: "b".repeat(24),
        parentCommentId: "comment-123",
        parentCommentUpdatedAt: "2026-05-14T11:59:00.000Z",
        threadCommentCount: 1,
      },
    },
    now,
  };
}

describe("PrismaGitHubUserReviewThreadResolver", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects a draining or guarded legacy entry before token, head, or thread reads", async () => {
    const prisma = createPrismaMock();
    resolutionHistory.enterLegacy.mockRejectedValueOnce(
      new Error("guarded_publication_required"),
    );
    const network = vi.fn();
    const resolver = new PrismaGitHubUserReviewThreadResolver(prisma, {
      env,
      fetch: network,
      resolutionHistory,
    });
    expect(
      await resolver.resolveReviewThreadLifecycle(request()),
    ).toMatchObject({
      status: "skipped",
      errorCode: "guarded_publication_required",
    });
    expect(prisma.repositoryPermissionCache.findMany).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(resolutionHistory.settleLegacy).not.toHaveBeenCalled();
  });
  it("uses a saved GitHub user token to guard and resolve a review thread", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            repository: {
              pullRequest: {
                headRefOid: "a".repeat(40),
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            node: {
              id: "thread-123",
              isResolved: false,
              viewerCanResolve: true,
              pullRequest: {
                number: 109,
                repository: { fullDatabaseId: "123" },
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "comment-123",
                    author: { login: "review-router-ai[bot]" },
                    body: `<!-- review-router-finding:${"b".repeat(24)} -->`,
                    createdAt: "2026-05-14T11:59:00.000Z",
                    updatedAt: "2026-05-14T11:59:00.000Z",
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            resolveReviewThread: {
              thread: {
                id: "thread-123",
                isResolved: true,
              },
            },
          },
        }),
      );
    const resolver = new PrismaGitHubUserReviewThreadResolver(
      createPrismaMock(),
      {
        env,
        fetch: fetch as unknown as typeof globalThis.fetch,
        resolutionHistory,
      },
    );

    const result = await resolver.resolveReviewThreadLifecycle(request());

    expect(result).toEqual({
      protocolVersion: 1,
      status: "resolved",
      resolvedBy: "github_user",
      reasonCodes: [],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      resolutionHistory.enterLegacy.mock.invocationCallOrder[0]!,
    ).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
    expect(
      resolutionHistory.settleLegacy.mock.calls.map((call) => call[1]),
    ).toEqual(["may_have_started", "confirmed"]);
    expect(fetch.mock.calls[2]![1]!.body).toContain("resolveReviewThread");
  });

  it("allows legacy GitHub Actions ReviewRouter parent comments", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            repository: {
              pullRequest: {
                headRefOid: "a".repeat(40),
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            node: {
              id: "thread-123",
              isResolved: false,
              viewerCanResolve: true,
              pullRequest: {
                number: 109,
                repository: { fullDatabaseId: "123" },
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "comment-123",
                    author: { login: "github-actions[bot]" },
                    body: `<!-- review-router-finding:${"b".repeat(24)} -->`,
                    createdAt: "2026-05-14T11:59:00.000Z",
                    updatedAt: "2026-05-14T11:59:00.000Z",
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            resolveReviewThread: {
              thread: {
                id: "thread-123",
                isResolved: true,
              },
            },
          },
        }),
      );
    const resolver = new PrismaGitHubUserReviewThreadResolver(
      createPrismaMock(),
      {
        env,
        fetch: fetch as unknown as typeof globalThis.fetch,
        resolutionHistory,
      },
    );

    const result = await resolver.resolveReviewThreadLifecycle(request());

    expect(result.status).toBe("resolved");
    expect(fetch.mock.calls[2]![1]!.body).toContain("resolveReviewThread");
  });

  it("normalizes configured GitHub App bot logins before trusting the parent comment", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            repository: {
              pullRequest: {
                headRefOid: "a".repeat(40),
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            node: {
              id: "thread-123",
              isResolved: false,
              viewerCanResolve: true,
              pullRequest: {
                number: 109,
                repository: { fullDatabaseId: "123" },
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "comment-123",
                    author: { login: "custom-reviewer[bot]" },
                    body: `<!-- review-router-finding:${"b".repeat(24)} -->`,
                    createdAt: "2026-05-14T11:59:00.000Z",
                    updatedAt: "2026-05-14T11:59:00.000Z",
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            resolveReviewThread: {
              thread: {
                id: "thread-123",
                isResolved: true,
              },
            },
          },
        }),
      );
    const resolver = new PrismaGitHubUserReviewThreadResolver(
      createPrismaMock(),
      {
        env: {
          ...env,
          REVIEW_APP_BOT_LOGIN: "custom-reviewer",
        },
        fetch: fetch as unknown as typeof globalThis.fetch,
        resolutionHistory,
      },
    );

    const result = await resolver.resolveReviewThreadLifecycle(request());

    expect(result.status).toBe("resolved");
  });

  it.each([
    {
      name: "foreign repository",
      pullRequest: { number: 109, repository: { fullDatabaseId: "999" } },
    },
    {
      name: "foreign pull request",
      pullRequest: { number: 110, repository: { fullDatabaseId: "123" } },
    },
    { name: "missing native membership", pullRequest: null },
  ])(
    "rejects $name with no native effect and settles the exact entered guard",
    async ({ pullRequest }) => {
      const network = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              repository: { pullRequest: { headRefOid: "a".repeat(40) } },
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              node: {
                id: "thread-123",
                isResolved: false,
                viewerCanResolve: true,
                pullRequest,
                comments: {
                  pageInfo: { hasNextPage: false },
                  nodes: [
                    {
                      id: "comment-123",
                      author: { login: "review-router-ai[bot]" },
                      body: `<!-- review-router-finding:${"b".repeat(24)} -->`,
                      createdAt: "2026-05-14T11:59:00.000Z",
                      updatedAt: "2026-05-14T11:59:00.000Z",
                    },
                  ],
                },
              },
            },
          }),
        );
      const resolver = new PrismaGitHubUserReviewThreadResolver(
        createPrismaMock(),
        { env, fetch: network, resolutionHistory },
      );
      const result = await resolver.resolveReviewThreadLifecycle(request());
      expect(result).toMatchObject({
        status: "skipped",
        reasonCodes: ["thread_changed_before_mutation"],
        errorCode: "thread_scope_mismatch",
      });
      expect(network).toHaveBeenCalledTimes(2);
      expect(
        network.mock.calls.every(
          (call) =>
            !String(call[1]?.body).includes(
              "mutation ReviewRouterUserResolveReviewThread",
            ),
        ),
      ).toBe(true);
      expect(
        resolutionHistory.enterLegacy.mock.invocationCallOrder[0]!,
      ).toBeLessThan(network.mock.invocationCallOrder[0]!);
      expect(
        resolutionHistory.settleLegacy.mock.calls.map((call) => call[1]),
      ).toEqual(["no_effect"]);
    },
  );

  it("allows a legitimate different authenticated connection and its own pull request", async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { repository: { pullRequest: { headRefOid: "a".repeat(40) } } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            node: {
              id: "thread-123",
              isResolved: false,
              viewerCanResolve: true,
              pullRequest: {
                number: 110,
                repository: { fullDatabaseId: "999" },
              },
              comments: {
                pageInfo: { hasNextPage: false },
                nodes: [
                  {
                    id: "comment-123",
                    author: { login: "review-router-ai[bot]" },
                    body: `<!-- review-router-finding:${"b".repeat(24)} -->`,
                    createdAt: "2026-05-14T11:59:00.000Z",
                    updatedAt: "2026-05-14T11:59:00.000Z",
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            resolveReviewThread: {
              thread: { id: "thread-123", isResolved: true },
            },
          },
        }),
      );
    const original = request();
    const authenticated = {
      ...original,
      repository: {
        ...original.repository,
        repositoryId: "repo_2",
        githubRepositoryId: "999",
        fullName: "another-owner/another-repo",
      },
      request: { ...original.request, pullRequestNumber: 110 },
    };
    const resolver = new PrismaGitHubUserReviewThreadResolver(
      createPrismaMock(),
      { env, fetch: network, resolutionHistory },
    );
    expect(
      await resolver.resolveReviewThreadLifecycle(authenticated),
    ).toMatchObject({ status: "resolved", resolvedBy: "github_user" });
    expect(resolutionHistory.enterLegacy).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryConnectionId: "repo_2",
        pullRequestNumber: 110,
      }),
    );
    expect(network).toHaveBeenCalledTimes(3);
    expect(
      resolutionHistory.settleLegacy.mock.calls.map((call) => call[1]),
    ).toEqual(["may_have_started", "confirmed"]);
  });

  it("identifies the actual qualified writer source with the membership-version policy", () => {
    const identity = legacyResolutionWriterSourceIdentity();
    expect(identity.sourceVersion).toBe(legacyResolutionWriterSourceVersion);
    expect(identity.sourceVersion).toBe(
      "rr_legacy_resolution_writer.v2_repository_pr_membership",
    );
    const actualSourceSha256 = createHash("sha256")
      .update(
        readFileSync(
          new URL(
            "./prisma-github-user-review-thread-resolver.ts",
            import.meta.url,
          ),
        ),
      )
      .digest("hex");
    expect(identity.sourceSha256).toBe(actualSourceSha256);
    expect(identity.writerDigest).toBe(
      createHash("sha256")
        .update(
          `rr.lifecycle_resolution_writer.source.v1\0rr_legacy_resolution_writer.v2_repository_pr_membership\0${actualSourceSha256}`,
        )
        .digest("hex"),
    );
    expect(identity.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.writerDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.writerDigest).not.toBe(identity.sourceSha256);
  });

  it("keeps the thread open when no authorized workspace user token is available", async () => {
    const prisma = createPrismaMock();
    vi.mocked(prisma.repositoryPermissionCache.findMany).mockResolvedValue([]);
    vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([]);
    const resolver = new PrismaGitHubUserReviewThreadResolver(prisma, {
      env,
      resolutionHistory,
    });

    const result = await resolver.resolveReviewThreadLifecycle(request());

    expect(result).toEqual({
      protocolVersion: 1,
      status: "missing_user_authorization",
      reasonCodes: ["missing_user_authorization"],
    });
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
