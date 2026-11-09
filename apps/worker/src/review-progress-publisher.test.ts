import { describe, expect, it, vi } from "vitest";
import type { ProgressSnapshot } from "@reviewrouter/features-review-progress";
import { ReviewProgressGitHubError } from "./review-progress-github-gateway";
import { ReviewProgressPublisher } from "./review-progress-publisher";
import type { ClaimedReviewProgress } from "./review-progress-store";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("ReviewProgressPublisher", () => {
  it("publishes through the installation and fences completion", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const calls: string[] = [];
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route, parameters = {}) => {
        calls.push(route);
        if (route.includes("/pulls/")) return pull();
        if (route.includes("/comments") && route.startsWith("GET"))
          return { data: [] };
        if (route.startsWith("POST")) {
          expect(parameters.body).toContain(
            "<!-- review-router-live-progress -->",
          );
          expect(parameters.body).toContain(
            "<!-- review-router-live-progress-source run-id=700001 run-attempt=2 -->",
          );
          return {
            data: {
              id: 77,
              body: parameters.body,
              user: { login: "review-router[bot]" },
            },
          };
        }
        throw new Error(`unexpected:${route}`);
      },
    }));

    await expect(publisher.runMaintenance()).resolves.toEqual({
      claimed: 1,
      published: 1,
      deferred: 0,
      suppressed: 0,
      failed: 0,
    });
    expect(calls).toEqual([
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    ]);
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        commentId: 77n,
        bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("does not report a stale fenced completion as published", async () => {
    const store = fakeStore(claimed());
    store.complete.mockResolvedValue(false);
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route, parameters = {}) => {
        if (route.includes("/pulls/")) return pull();
        if (route.startsWith("GET")) return { data: [] };
        if (route.startsWith("POST")) {
          return {
            data: {
              id: 77,
              body: parameters.body,
              user: { login: "review-router[bot]" },
            },
          };
        }
        throw new Error(`unexpected:${route}`);
      },
    }));

    await expect(publisher.runMaintenance()).resolves.toEqual({
      claimed: 1,
      published: 0,
      deferred: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(store.complete).toHaveBeenCalledOnce();
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.suppress).not.toHaveBeenCalled();
  });

  it("defers without touching GitHub when the installation budget is busy", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const retryAt = new Date(now.getTime() + 2_000);
    store.reserveInstallationMutation = vi.fn(async () => ({
      allowed: false as const,
      retryAt,
    })) as typeof store.reserveInstallationMutation;
    const factory = vi.fn();

    await expect(
      createPublisher(store, factory).runMaintenance(),
    ).resolves.toMatchObject({
      claimed: 1,
      deferred: 1,
      published: 0,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({ retryAt }),
    );
  });

  it("suppresses a corrupt durable snapshot without affecting the review", async () => {
    const publication = { ...claimed(), snapshot: { schemaVersion: 9 } };
    const store = fakeStore(publication);

    await expect(
      createPublisher(store, vi.fn()).runMaintenance(),
    ).resolves.toMatchObject({
      claimed: 1,
      suppressed: 1,
      failed: 0,
    });
    expect(store.suppress).toHaveBeenCalledWith(
      expect.objectContaining({
        safeCode: "review_progress_snapshot_invalid",
      }),
    );
  });

  it("publishes a legacy v1 snapshot without a source marker", async () => {
    const legacySnapshot = { ...progressSnapshot() };
    delete legacySnapshot.sourceIdentity;
    const publication = claimed(legacySnapshot);
    const store = fakeStore(publication);
    const bodies: string[] = [];
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route, parameters = {}) => {
        if (route.includes("/pulls/")) return pull();
        if (route.startsWith("GET")) return { data: [] };
        bodies.push(String(parameters.body));
        return {
          data: {
            id: 77,
            body: parameters.body,
            user: { login: "review-router[bot]" },
          },
        };
      },
    }));
    await expect(publisher.runMaintenance()).resolves.toMatchObject({
      published: 1,
      suppressed: 0,
    });
    expect(bodies[0]).not.toContain("review-router-live-progress-source");
  });

  it("suppresses a malformed source identity", async () => {
    const publication = claimed({
      ...progressSnapshot(),
      sourceIdentity: { sourceRunId: "700001 -->", sourceRunAttempt: "2" },
    });
    const store = fakeStore(publication);
    const factory = vi.fn();
    await expect(
      createPublisher(store, factory).runMaintenance(),
    ).resolves.toMatchObject({ suppressed: 1, published: 0 });
    expect(factory).not.toHaveBeenCalled();
  });

  it("coalesces 72 durable events into one latest-version GitHub mutation", async () => {
    const publication = { ...claimed(), desiredVersion: 72n };
    const store = fakeStore(publication);
    const post = vi.fn(
      async (
        _route: string,
        parameters: Readonly<Record<string, unknown>> = {},
      ) => ({
        data: {
          id: 77,
          body: parameters.body,
          user: { login: "review-router[bot]" },
        },
      }),
    );
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route, parameters = {}) => {
        if (route.includes("/pulls/")) return pull();
        if (route.startsWith("GET")) return { data: [] };
        return post(route, parameters);
      },
    }));

    await publisher.runMaintenance();

    expect(post).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        publication: expect.objectContaining({ desiredVersion: 72n }),
      }),
    );
  });

  it("defers completion while marked duplicates remain for cleanup", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const comment = {
      body: "<!-- review-router-live-progress -->",
      user: { login: "review-router[bot]" },
    };
    const firstComment = { ...comment, id: 77 };
    const secondComment = { ...comment, id: 78 };
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route) => {
        if (route.includes("/pulls/")) return pull();
        if (route.startsWith("GET")) {
          return { data: [firstComment, secondComment] };
        }
        if (route.startsWith("PATCH")) return { data: {} };
        throw new Error(`unexpected:${route}`);
      },
    }));

    await expect(publisher.runMaintenance()).resolves.toEqual({
      claimed: 1,
      published: 0,
      deferred: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        safeCode: "review_progress_duplicate_cleanup_pending",
        retryAt: new Date(now.getTime() + 1_000),
        countFailure: false,
        maxFailures: 3,
      }),
    );
  });

  it("backs off capped scans for an hour without exhausting retries", async () => {
    const publication = { ...claimed(), failureCount: 2 };
    const store = fakeStore(publication);
    const pages: number[] = [];
    const publisher = createPublisher(store, async () => ({
      botLogin: "review-router[bot]",
      request: async (route, parameters = {}) => {
        if (route.includes("/pulls/")) return pull();
        if (
          route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
        ) {
          const page = Number(parameters.page);
          pages.push(page);
          return {
            data: Array.from({ length: 100 }, (_, index) => ({
              id: page * 100 + index,
              body: "unrelated",
              user: { login: "someone-else" },
            })),
          };
        }
        throw new Error(`unexpected:${route}`);
      },
    }));

    await expect(publisher.runMaintenance()).resolves.toEqual({
      claimed: 1,
      published: 0,
      deferred: 1,
      suppressed: 0,
      failed: 0,
    });
    expect(pages).toEqual([1, 2]);
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        safeCode: "review_progress_pagination_inconclusive",
        retryAt: new Date(now.getTime() + 60 * 60_000),
        countFailure: false,
        maxFailures: 3,
      }),
    );
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.suppress).not.toHaveBeenCalled();
  });

  it("suppresses a poison publication at the retry bound", async () => {
    const publication = { ...claimed(), failureCount: 2 };
    const store = fakeStore(publication);
    store.retry.mockResolvedValue("suppressed");
    const publisher = createPublisher(store, async () => {
      throw new Error("invalid_installation");
    });

    await expect(publisher.runMaintenance()).resolves.toMatchObject({
      claimed: 1,
      suppressed: 1,
      failed: 0,
    });
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({ maxFailures: 3 }),
    );
  });

  it("uses the GitHub rate-limit retry boundary as installation cooldown", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const retryAt = new Date(now.getTime() + 60_000);
    const factory = vi.fn(async () => {
      throw new ReviewProgressGitHubError("rate_limited", "limited", {
        retryable: true,
        retryAt,
      });
    });

    await expect(
      createPublisher(store, factory).runMaintenance(),
    ).resolves.toMatchObject({ claimed: 1, failed: 1, suppressed: 0 });
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        safeCode: "review_progress_rate_limited",
        retryAt,
        installationCooldownUntil: retryAt,
        maxFailures: 3,
      }),
    );
    expect(store.suppress).not.toHaveBeenCalled();
  });

  it("retries unknown failures using the fallback delay", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const publisher = createPublisher(store, async () => {
      throw new Error("installation_transient");
    });

    await expect(publisher.runMaintenance()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
      suppressed: 0,
    });
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        safeCode: "review_progress_publish_failed",
        retryAt: new Date(now.getTime() + 5_000),
        now,
      }),
    );
    expect(store.suppress).not.toHaveBeenCalled();
  });

  it("suppresses a non-retryable GitHub error without scheduling retry", async () => {
    const publication = claimed();
    const store = fakeStore(publication);
    const factory = vi.fn(async () => {
      throw new ReviewProgressGitHubError("revoked_app", "revoked", {
        retryable: false,
      });
    });

    await expect(
      createPublisher(store, factory).runMaintenance(),
    ).resolves.toMatchObject({ claimed: 1, suppressed: 1, failed: 0 });
    expect(store.suppress).toHaveBeenCalledWith(
      expect.objectContaining({
        publication,
        safeCode: "review_progress_revoked_app",
      }),
    );
    expect(store.retry).not.toHaveBeenCalled();
  });
});

function createPublisher(
  store: ReturnType<typeof fakeStore>,
  factory: ConstructorParameters<typeof ReviewProgressPublisher>[1],
) {
  return new ReviewProgressPublisher(
    store,
    factory,
    { now: () => now },
    "a".repeat(64),
    {
      limit: 2,
      claimDurationMs: 60_000,
      minimumMutationIntervalMs: 1_000,
      retryDelayMs: 5_000,
      maxCommentPages: 2,
      maxFailures: 3,
    },
  );
}

function fakeStore(publication: ClaimedReviewProgress) {
  let claimedOnce = false;
  return {
    claimNext: vi.fn(async () => {
      if (claimedOnce) return null;
      claimedOnce = true;
      return publication;
    }),
    reserveInstallationMutation: vi.fn(
      async (): Promise<
        { allowed: true } | { allowed: false; retryAt: Date }
      > => ({ allowed: true as const }),
    ),
    complete: vi.fn(async () => true),
    retry: vi.fn(async (): Promise<"retried" | "suppressed"> => "retried"),
    suppress: vi.fn(async () => true),
  };
}

function claimed(
  snapshot: unknown = progressSnapshot(),
): ClaimedReviewProgress {
  return {
    scope: {
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    },
    executionId: "execution-1",
    generation: 1n,
    headSha: "a".repeat(40),
    planHash: "b".repeat(64),
    desiredVersion: 2n,
    publishedVersion: 1n,
    commentId: null,
    publishedBodyHash: null,
    failureCount: 0,
    snapshot,
    terminal: false,
    repository: { owner: "acme", name: "rocket", githubInstallationId: 9n },
    claim: {
      claimId: "claim-1",
      ownerIdHash: "a".repeat(64),
      claimUntil: new Date(now.getTime() + 60_000),
    },
  };
}

function progressSnapshot(): ProgressSnapshot {
  return {
    schemaVersion: 1,
    generation: 1,
    phase: "reviewing",
    terminal: "none",
    updatedAt: now.toISOString(),
    counts: {
      total: 2,
      completed: 1,
      exhausted: 0,
      cancelled: 0,
      running: 1,
      pending: 0,
      retrying: 0,
      recovered: 0,
      requiredTotal: 2,
      requiredCompleted: 1,
      requiredExhausted: 0,
      requiredCancelled: 0,
      optionalTotal: 0,
      optionalCompleted: 0,
    },
    fileCoverage: { valid: false },
    sourceIdentity: { sourceRunId: "700001", sourceRunAttempt: "2" },
  };
}

function pull() {
  return {
    data: {
      state: "open",
      head: { sha: "a".repeat(40) },
      base: { repo: { full_name: "acme/rocket" } },
    },
  };
}
