import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  CompositeReviewStateAccess,
  PrismaHostedReviewStateAccess,
  authorizeHostedReviewStateScope,
} from "./hosted-review-state-access.js";

const now = new Date("2026-09-22T10:00:00.000Z");

describe("hosted review state access", () => {
  it.each(["issued", "exhausted"])(
    "authorizes an unexpired %s grant only for its admitted run and PR",
    async (status) => {
      const fixture = authorityFixture();
      fixture.grant.status = status;
      expect(authorizeHostedReviewStateScope(fixture)).toEqual({
        workspaceId: "workspace-1",
        repositoryId: "repository-1",
        sourceRunId: "9001",
        sourceRunAttempt: "2",
        pullRequestNumber: 118,
      });
    },
  );

  it.each([
    "expired grant",
    "closed runtime gate",
    "stale binding",
    "stale pool epoch",
    "wrong provider instance",
    "wrong review intent run",
    "wrong pull request",
  ])("rejects %s", (scenario) => {
    const fixture = authorityFixture();
    if (scenario === "expired grant") fixture.grant.expiresAt = now;
    if (scenario === "closed runtime gate")
      fixture.runtimeGate.status = "closed";
    if (scenario === "stale binding") fixture.grant.binding.revision = 8n;
    if (scenario === "stale pool epoch") {
      fixture.grant.binding.pool.authzEpoch = 8n;
    }
    if (scenario === "wrong provider instance") {
      fixture.input.providerInstanceId = "hosted-pool:repository:778";
    }
    if (scenario === "wrong review intent run") {
      fixture.reviewIntent.sourceRunId = "9002";
    }
    if (scenario === "wrong pull request") {
      fixture.reviewIntent.pullRequestNumber = 119;
    }
    expect(() => authorizeHostedReviewStateScope(fixture)).toThrow(
      "hosted_review_state_authority_mismatch",
    );
  });

  it("loads current authority and applies the authorized scope inside the transaction", async () => {
    const fixture = authorityFixture();
    const transaction = {
      hostedCodexInvocationGrant: {
        findUnique: vi.fn().mockResolvedValue(fixture.grant),
      },
      hostedCodexRuntimeGate: {
        findUnique: vi.fn().mockResolvedValue(fixture.runtimeGate),
      },
      reviewRequestedIntent: {
        findUnique: vi.fn().mockResolvedValue(fixture.reviewIntent),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const access = new PrismaHostedReviewStateAccess(prisma);
    const effect = vi.fn().mockResolvedValue("committed");

    await expect(
      access.withAuthorizedReviewSnapshotAccess(fixture.input, effect),
    ).resolves.toBe("committed");
    expect(effect).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      repositoryId: "repository-1",
      sourceRunId: "9001",
      sourceRunAttempt: "2",
      pullRequestNumber: 118,
    });
  });

  it("routes hosted provider identities without weakening the legacy boundary", async () => {
    const scope = {
      workspaceId: "workspace-1",
      repositoryId: "repository-1",
      sourceRunId: "9001",
      sourceRunAttempt: "2",
      pullRequestNumber: 118,
    };
    const legacy = stateAccessStub(scope);
    const hosted = stateAccessStub(scope);
    const access = new CompositeReviewStateAccess(legacy, hosted);
    const effect = vi.fn().mockResolvedValue("ok");

    await access.withAuthorizedReviewSnapshotAccess(
      authorityFixture().input,
      effect,
    );
    await access.withAuthorizedReviewExecutionCheckpointAccess(
      {
        ...authorityFixture().input,
        providerInstanceId: "codex-rotating:777",
      },
      effect,
    );

    expect(hosted.withAuthorizedReviewSnapshotAccess).toHaveBeenCalledOnce();
    expect(
      legacy.withAuthorizedReviewExecutionCheckpointAccess,
    ).toHaveBeenCalledOnce();
  });
});

function authorityFixture() {
  return {
    input: {
      leaseId: "grant-1",
      providerInstanceId: "hosted-pool:repository:777",
      pullRequestNumber: 118,
      now,
    },
    grant: {
      status: "issued",
      revokedAt: null,
      expiresAt: new Date("2026-09-22T11:00:00.000Z"),
      workspaceId: "workspace-1",
      poolId: "pool-1",
      repositoryConnectionId: "repository-1",
      repositoryBindingId: "binding-1",
      reviewRequestId: "request-1",
      runId: "9001",
      runAttempt: 2,
      bindingRevision: 7n,
      authzEpoch: 3n,
      runtimeAuthzEpoch: 5n,
      binding: {
        id: "binding-1",
        workspaceId: "workspace-1",
        poolId: "pool-1",
        repositoryConnectionId: "repository-1",
        status: "active",
        revision: 7n,
        attestedGithubRepositoryId: 777n,
        attestedBindingRevision: 7n,
        pool: { status: "active", authzEpoch: 3n },
        repository: {
          id: "repository-1",
          workspaceId: "workspace-1",
          provider: "github",
          githubRepositoryId: 777n,
          selected: true,
          archived: false,
          visibility: "private",
          installation: { status: "active" },
        },
      },
    },
    runtimeGate: { status: "active", authzEpoch: 5n },
    reviewIntent: {
      requestId: "request-1",
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      pullRequestNumber: 118,
      sourceRunId: "9001",
      sourceRunAttempt: "2",
      admissionState: "admitted",
      state: "dispatched",
    },
  };
}

function stateAccessStub(
  scope: ReturnType<typeof authorizeHostedReviewStateScope>,
) {
  return {
    withAuthorizedReviewSnapshotAccess: vi.fn(async (_input, effect) =>
      effect(scope),
    ),
    withAuthorizedReviewExecutionCheckpointAccess: vi.fn(
      async (_input, effect) => effect(scope),
    ),
  };
}
