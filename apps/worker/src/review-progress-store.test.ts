import { describe, expect, it, vi } from "vitest";
import { PrismaReviewProgressPublicationStore } from "./review-progress-store";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("PrismaReviewProgressPublicationStore fencing", () => {
  it("does not complete a stale claim after a newer generation wins the scope", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const store = new PrismaReviewProgressPublicationStore({
      reviewProgressPublicationV1: { updateMany },
    } as never);

    await expect(
      store.complete({
        publication: claimed(),
        commentId: 42n,
        bodyHash: "c".repeat(64),
        now,
      }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activeExecutionId: "execution-1",
          activeGeneration: 7n,
          activeHeadSha: "a".repeat(40),
          activePlanHash: "b".repeat(64),
          desiredVersion: 73n,
          claimId: "claim-1",
        }),
      }),
    );
  });

  it("fences every progress mutation to the same claim identity", async () => {
    const publication = claimed();
    const whereClauses: unknown[] = [];
    const updateMany = vi.fn(async ({ where }: { readonly where: unknown }) => {
      whereClauses.push(where);
      return { count: 1 };
    });
    const count = vi.fn(async ({ where }: { readonly where: unknown }) => {
      whereClauses.push(where);
      return 1;
    });
    const prisma = {
      reviewProgressPublicationV1: { updateMany },
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $executeRaw: async () => 1,
          $queryRaw: async () => [],
          reviewProgressPublicationV1: { updateMany, count },
          reviewProgressInstallationBudgetV1: {
            findUniqueOrThrow: async () => ({
              nextMutationAt: now,
              cooldownUntil: null,
            }),
            update: async () => ({}),
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.reserveInstallationMutation({
        publication,
        now,
        minimumIntervalMs: 1_000,
      }),
    ).resolves.toEqual({ allowed: true });
    await store.complete({
      publication,
      commentId: 42n,
      bodyHash: "c".repeat(64),
      now,
    });
    await store.retry({
      publication,
      safeCode: "retryable",
      retryAt: new Date(now.getTime() + 1_000),
      now,
      maxFailures: 3,
    });
    await store.suppress({ publication, safeCode: "suppressed", now });

    const fence = {
      ...publication.scope,
      activeExecutionId: publication.executionId,
      activeGeneration: publication.generation,
      activeHeadSha: publication.headSha,
      activePlanHash: publication.planHash,
      desiredVersion: publication.desiredVersion,
      claimId: publication.claim.claimId,
      claimOwnerIdHash: publication.claim.ownerIdHash,
    };
    expect(whereClauses).toEqual([
      { ...fence, claimUntil: { gt: now } },
      fence,
      fence,
      fence,
    ]);
  });

  it("does not consume installation budget after losing the claim fence", async () => {
    const budgetUpdate = vi.fn();
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $executeRaw: async () => 1,
          $queryRaw: async () => [],
          reviewProgressInstallationBudgetV1: {
            findUniqueOrThrow: async () => ({
              nextMutationAt: now,
              cooldownUntil: null,
            }),
            update: budgetUpdate,
          },
          reviewProgressPublicationV1: { count: async () => 0 },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.reserveInstallationMutation({
        publication: claimed(),
        now,
        minimumIntervalMs: 1_000,
      }),
    ).resolves.toEqual({ allowed: false, retryAt: now });
    expect(budgetUpdate).not.toHaveBeenCalled();
  });

  it("persists installation cooldown with monotonic database GREATEST", async () => {
    const rawQueries: unknown[] = [];
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewProgressPublicationV1: {
            updateMany: vi.fn(async () => ({ count: 1 })),
          },
          $executeRaw: async (query: unknown) => {
            rawQueries.push(query);
            return 1;
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await store.retry({
      publication: claimed(),
      safeCode: "review_progress_rate_limited",
      retryAt: new Date(now.getTime() + 1_000),
      installationCooldownUntil: new Date(now.getTime() + 60_000),
      now,
      maxFailures: 10,
    });

    const query = rawQueries[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain('"nextMutationAt" = GREATEST');
    expect(query.strings.join(" ")).toContain('"cooldownUntil" = GREATEST');
  });

  it("fails retry when installation cooldown persistence fails", async () => {
    const calls: string[] = [];
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewProgressPublicationV1: {
            updateMany: async () => {
              calls.push("publication");
              return { count: 1 };
            },
          },
          $executeRaw: async () => {
            calls.push("cooldown");
            throw new Error("cooldown_failed");
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.retry({
        publication: claimed(),
        safeCode: "review_progress_rate_limited",
        retryAt: new Date(now.getTime() + 1_000),
        installationCooldownUntil: new Date(now.getTime() + 60_000),
        now,
        maxFailures: 3,
      }),
    ).rejects.toThrow("cooldown_failed");
    expect(calls).toEqual(["publication", "cooldown"]);
  });

  it("orders terminal snapshots before ordinary due progress", async () => {
    const rawQueries: unknown[] = [];
    const publicationLookup = vi.fn();
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: async (query: unknown) => {
            rawQueries.push(query);
            return [];
          },
          reviewProgressPublicationV1: { findUniqueOrThrow: publicationLookup },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.claimNext({
        ownerIdHash: "d".repeat(64),
        now,
        claimDurationMs: 60_000,
      }),
    ).resolves.toBeNull();
    expect(publicationLookup).not.toHaveBeenCalled();
    const query = rawQueries[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain(
      'progress."terminalOutcome" IS NOT NULL',
    );
    expect(query.strings.join(" ")).toContain("THEN 0 ELSE 1 END");
    expect(query.strings.join(" ")).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("defers a stale projection before repository lookup", async () => {
    const scope = {
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    };
    const deferUpdate = vi.fn(async () => ({}));
    const repositoryLookup = vi.fn();
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: async () => [scope],
          reviewProgressPublicationV1: {
            findUniqueOrThrow: async () => ({
              ...scope,
              activeExecutionId: "execution-1",
              activeGeneration: 7n,
              activeHeadSha: "a".repeat(40),
              activePlanHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
            update: deferUpdate,
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              generation: 8n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
          },
          repositoryConnection: { findUnique: repositoryLookup },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.claimNext({
        ownerIdHash: "d".repeat(64),
        now,
        claimDurationMs: 60_000,
      }),
    ).resolves.toBeNull();
    expect(repositoryLookup).not.toHaveBeenCalled();
    expect(deferUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: "review_progress_projection_identity_corrupted",
        }),
      }),
    );
  });

  it("defers an inactive GitHub installation before writing a claim", async () => {
    const scope = {
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    };
    const publicationUpdate = vi.fn(async () => ({}));
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: async () => [scope],
          reviewProgressPublicationV1: {
            findUniqueOrThrow: async () => ({
              ...scope,
              activeExecutionId: "execution-1",
              activeGeneration: 7n,
              activeHeadSha: "a".repeat(40),
              activePlanHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
            update: publicationUpdate,
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              generation: 7n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
          },
          repositoryConnection: {
            findUnique: async () => ({
              workspaceId: "workspace-1",
              scmRepositoryIdentityId: "identity-1",
              selected: true,
              archived: false,
              provider: "github",
              installation: {
                githubInstallationId: 112n,
                status: "suspended",
              },
            }),
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.claimNext({
        ownerIdHash: "d".repeat(64),
        now,
        claimDurationMs: 60_000,
      }),
    ).resolves.toBeNull();
    expect(publicationUpdate).toHaveBeenCalledTimes(1);
    expect(publicationUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          scope,
      },
      data: {
        failureCount: { increment: 1 },
        lastErrorCode: "review_progress_github_repository_unavailable",
        nextPublishAt: new Date(now.getTime() + 60_000),
        updatedAt: now,
      },
    });
  });

  it("writes a fenced claim before returning the matching publication", async () => {
    const scope = {
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    };
    const claimUpdate = vi.fn(async () => ({}));
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: async () => [scope],
          reviewProgressPublicationV1: {
            findUniqueOrThrow: async () => ({
              ...scope,
              activeExecutionId: "execution-1",
              activeGeneration: 7n,
              activeHeadSha: "a".repeat(40),
              activePlanHash: "b".repeat(64),
              desiredVersion: 73n,
              publishedVersion: 72n,
              commentId: 99n,
              publishedBodyHash: "c".repeat(64),
              failureCount: 0,
            }),
            update: claimUpdate,
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              executionId: "execution-1",
              generation: 7n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              desiredVersion: 73n,
              snapshotJson: { phase: "running" },
              terminalOutcome: null,
            }),
          },
          repositoryConnection: {
            findUnique: async () => ({
              workspaceId: "workspace-1",
              scmRepositoryIdentityId: "identity-1",
              selected: true,
              archived: false,
              provider: "github",
              owner: "acme",
              name: "rocket",
              installation: { githubInstallationId: 112n, status: "active" },
            }),
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    const publication = await store.claimNext({
      ownerIdHash: "d".repeat(64),
      now,
      claimDurationMs: 60_000,
    });

    expect(publication).toMatchObject({
      scope,
      executionId: "execution-1",
      desiredVersion: 73n,
      publishedVersion: 72n,
      commentId: 99n,
      terminal: false,
      repository: {
        owner: "acme",
        name: "rocket",
        githubInstallationId: 112n,
      },
      claim: {
        claimId: expect.any(String),
        ownerIdHash: "d".repeat(64),
        claimUntil: new Date(now.getTime() + 60_000),
      },
    });
    expect(claimUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          scope,
      },
      data: {
        claimId: publication?.claim.claimId,
        claimOwnerIdHash: "d".repeat(64),
        claimUntil: new Date(now.getTime() + 60_000),
      },
    });
  });

  it("suppresses when the desired version reaches its retry bound", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewProgressPublicationV1: { updateMany },
          $executeRaw: vi.fn(),
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);
    await expect(
      store.retry({
        publication: { ...claimed(), failureCount: 2 },
        safeCode: "review_progress_publish_failed",
        retryAt: new Date(now.getTime() + 1_000),
        now,
        maxFailures: 3,
      }),
    ).resolves.toBe("suppressed");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publishedVersion: 73n,
          lastErrorCode: "review_progress_retry_limit_reached",
        }),
      }),
    );
  });

  it("does not exhaust a claim or increment failures for budget deferrals", async () => {
    const recorded: Record<string, unknown>[] = [];
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewProgressPublicationV1: {
            updateMany: async (input: { data: Record<string, unknown> }) => {
              recorded.push(input.data);
              return { count: 1 };
            },
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.retry({
        publication: { ...claimed(), failureCount: 2 },
        safeCode: "review_progress_installation_budget_wait",
        retryAt: new Date(now.getTime() + 5_000),
        now,
        maxFailures: 3,
        countFailure: false,
      }),
    ).resolves.toBe("retried");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      lastErrorCode: "review_progress_installation_budget_wait",
    });
    expect(recorded[0]).not.toHaveProperty("publishedVersion");
    expect(recorded[0]).not.toHaveProperty("failureCount");
  });

  it("limits hosted claims to the explicit repository cohort", async () => {
    const rawQueries: unknown[] = [];
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: async (query: unknown) => {
            rawQueries.push(query);
            return [];
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never, {
      allowedRepositoryFullNames: new Set(["acme/rocket"]),
    });

    await store.claimNext({
      ownerIdHash: "d".repeat(64),
      now,
      claimDurationMs: 60_000,
    });

    const query = rawQueries[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain(
      'LOWER(repository."fullName") IN',
    );
  });

  it("does not promote a settled execution after its projection is superseded", async () => {
    const progressUpdate = vi.fn();
    const publicationUpdate = vi.fn();
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewExecutionV2: {
            findUnique: async () => ({
              executionId: "execution-1",
              state: "completed",
            }),
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              executionId: "execution-1",
              workspaceId: "workspace-1",
              repositoryConnectionId: "repository-1",
              scmRepositoryIdentityId: "identity-1",
              pullRequestNumber: 42,
              generation: 7n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              terminalOutcome: null,
            }),
            update: progressUpdate,
          },
          reviewProgressPublicationV1: {
            findUnique: async () => ({
              activeExecutionId: "execution-2",
              activeGeneration: 8n,
              activeHeadSha: "c".repeat(40),
              activePlanHash: "d".repeat(64),
            }),
            update: publicationUpdate,
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.promoteSettledExecutions({
        settlements: [{ executionId: "execution-1", outcome: "succeeded" }],
        now,
      }),
    ).resolves.toBe(0);
    expect(progressUpdate).not.toHaveBeenCalled();
    expect(publicationUpdate).not.toHaveBeenCalled();
  });

  it("publishes a failed terminal state when final review publication failed", async () => {
    const mutationOrder: string[] = [];
    const progressUpdate = vi.fn(async () => {
      mutationOrder.push("progress");
      return {};
    });
    const publicationUpdate = vi.fn(async () => {
      mutationOrder.push("publication");
      return {};
    });
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewExecutionV2: {
            findUnique: async () => ({
              executionId: "execution-1",
              state: "completed",
            }),
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              executionId: "execution-1",
              workspaceId: "workspace-1",
              repositoryConnectionId: "repository-1",
              scmRepositoryIdentityId: "identity-1",
              pullRequestNumber: 42,
              generation: 7n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              terminalOutcome: null,
              snapshotJson: {
                schemaVersion: 1,
                phase: "publishing",
                counts: {
                  requiredTotal: 1,
                  requiredCompleted: 1,
                  requiredExhausted: 0,
                  requiredCancelled: 0,
                },
              },
            }),
            update: progressUpdate,
          },
          reviewProgressPublicationV1: {
            findUnique: async () => ({
              activeExecutionId: "execution-1",
              activeGeneration: 7n,
              activeHeadSha: "a".repeat(40),
              activePlanHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
            update: publicationUpdate,
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.promoteSettledExecutions({
        settlements: [{ executionId: "execution-1", outcome: "failed" }],
        now,
      }),
    ).resolves.toBe(1);
    expect(mutationOrder).toEqual(["progress", "publication"]);
    expect(progressUpdate).toHaveBeenCalledWith({
      where: { executionId: "execution-1" },
      data: {
        phase: "terminal",
        terminalOutcome: "failed",
        snapshotJson: {
          schemaVersion: 1,
          phase: "terminal",
          terminal: "failed",
          counts: {
            requiredTotal: 1,
            requiredCompleted: 1,
            requiredExhausted: 0,
            requiredCancelled: 0,
          },
          updatedAt: now.toISOString(),
        },
        snapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        desiredVersion: 74n,
        updatedAt: now,
      },
    });
    expect(publicationUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
          {
            workspaceId: "workspace-1",
            repositoryConnectionId: "repository-1",
            scmRepositoryIdentityId: "identity-1",
            pullRequestNumber: 42,
          },
      },
      data: {
        version: { increment: 1n },
        desiredVersion: 74n,
        nextPublishAt: now,
        updatedAt: now,
      },
    });
  });
  it("rejects partial terminal counts without gaps", async () => {
    const progressUpdate = vi.fn();
    const publicationUpdate = vi.fn();
    const prisma = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation({
          reviewExecutionV2: {
            findUnique: async () => ({
              executionId: "execution-1",
              state: "partial",
            }),
          },
          reviewExecutionProgressV1: {
            findUnique: async () => ({
              executionId: "execution-1",
              workspaceId: "workspace-1",
              repositoryConnectionId: "repository-1",
              scmRepositoryIdentityId: "identity-1",
              pullRequestNumber: 42,
              generation: 7n,
              headSha: "a".repeat(40),
              planHash: "b".repeat(64),
              terminalOutcome: null,
              snapshotJson: {
                schemaVersion: 1,
                phase: "publishing",
                counts: {
                  requiredTotal: 1,
                  requiredCompleted: 1,
                  requiredExhausted: 0,
                  requiredCancelled: 0,
                },
              },
            }),
            update: progressUpdate,
          },
          reviewProgressPublicationV1: {
            findUnique: async () => ({
              activeExecutionId: "execution-1",
              activeGeneration: 7n,
              activeHeadSha: "a".repeat(40),
              activePlanHash: "b".repeat(64),
              desiredVersion: 73n,
            }),
            update: publicationUpdate,
          },
        }),
    };
    const store = new PrismaReviewProgressPublicationStore(prisma as never);

    await expect(
      store.promoteSettledExecutions({
        settlements: [{ executionId: "execution-1", outcome: "succeeded" }],
        now,
      }),
    ).rejects.toThrow("review_progress_partial_outcome_inconsistent");
    expect(progressUpdate).not.toHaveBeenCalled();
    expect(publicationUpdate).not.toHaveBeenCalled();
  });
});

function claimed() {
  return {
    scope: {
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    },
    executionId: "execution-1",
    generation: 7n,
    headSha: "a".repeat(40),
    planHash: "b".repeat(64),
    desiredVersion: 73n,
    publishedVersion: 72n,
    commentId: 9n,
    publishedBodyHash: null,
    failureCount: 0,
    snapshot: {},
    terminal: false,
    repository: { owner: "acme", name: "rocket", githubInstallationId: 17n },
    claim: {
      claimId: "claim-1",
      ownerIdHash: "d".repeat(64),
      claimUntil: new Date(now.getTime() + 60_000),
    },
  } as const;
}
