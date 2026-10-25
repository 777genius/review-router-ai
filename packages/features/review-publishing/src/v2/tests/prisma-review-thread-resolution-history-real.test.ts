import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import {
  evaluateResolutionHistory,
  type ReviewPublicationScope,
} from "../index";
import {
  PrismaReviewThreadResolutionHistory,
  recordPendingResolution,
  settleResolution,
} from "../infrastructure/prisma/prisma-review-thread-resolution-history";

import { controlledRetiredWriterProof } from "./resolution-history-fixtures";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
// The deployment gate runs this file against a disposable PostgreSQL database.
describeDatabase("resolution history PostgreSQL connection fence", () => {
  let prisma: PrismaClient;
  let scope: ReviewPublicationScope;
  let history: PrismaReviewThreadResolutionHistory;
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 8 });
    history = new PrismaReviewThreadResolutionHistory(prisma);
  });
  beforeEach(async () => {
    const id = randomUUID();
    scope = {
      workspaceId: `history-workspace-${id}`,
      repositoryConnectionId: `history-repository-${id}`,
      scmRepositoryIdentityId: `history-scm-${id}`,
      pullRequestNumber: 1,
    };
    await prisma.workspace.create({
      data: {
        id: scope.workspaceId,
        slug: `history-${id}`,
        name: "Disposable history test",
      },
    });
    await prisma.scmRepositoryIdentity.create({
      data: {
        scmRepositoryIdentityId: scope.scmRepositoryIdentityId,
        provider: "github",
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: id,
        createdAt: new Date(),
      },
    });
    await prisma.repositoryConnection.create({
      data: {
        id: scope.repositoryConnectionId,
        workspaceId: scope.workspaceId,
        scmRepositoryIdentityId: scope.scmRepositoryIdentityId,
        externalRepositoryId: id,
        owner: "history-test",
        name: id,
        fullName: `history-test/${id}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
  });
  afterEach(async () => {
    if (scope) {
      await prisma.reviewThreadResolutionGuardV1.deleteMany({
        where: { repositoryConnectionId: scope.repositoryConnectionId },
      });
      await prisma.repositoryConnection.delete({
        where: { id: scope.repositoryConnectionId },
      });
      await prisma.scmRepositoryIdentity.delete({
        where: { scmRepositoryIdentityId: scope.scmRepositoryIdentityId },
      });
      await prisma.workspace.delete({ where: { id: scope.workspaceId } });
    }
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it("accounts a paused legacy writer before drain and preserves its settlement after qualified cut", async () => {
    const entryInput = {
      ...scope,
      threadId: "paused-legacy",
      reviewedHeadSha: "a".repeat(40),
      bodyHash: "b".repeat(64),
      now: new Date(),
    };
    const [left, right] = await Promise.allSettled([
      history.enterLegacy(entryInput),
      history.enterLegacy(entryInput),
    ]);
    const accepted =
      left.status === "fulfilled"
        ? left.value
        : right.status === "fulfilled"
          ? right.value
          : null;
    expect([left.status, right.status].sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    if (!accepted) throw new Error("test_legacy_not_entered");
    await history.settleLegacy(accepted, "may_have_started", new Date());
    await history.beginDrain(scope);
    await expect(
      history.enterLegacy({ ...entryInput, threadId: "new-during-drain" }),
    ).rejects.toThrow("resolution_writers_draining");
    await expect(
      history.activate(scope, {
        writerDigest: "d".repeat(64),
        qualificationSource: "passive_zero_counters" as never,
        executors: [],
      }),
    ).rejects.toThrow("resolution_writer_quiescence_unqualified");
    const prior = (await history.read(scope, [accepted.scope.threadId]))[0]!;
    expect(prior.historyCut).toBeNull();
    expect(prior.pending).toMatchObject([
      { operationId: accepted.operationId, state: "may_have_started" },
    ]);
    await history.activate(scope, managedWriterProof());
    await expect(
      history.enterLegacy({ ...entryInput, threadId: "new-after-activation" }),
    ).rejects.toThrow("guarded_publication_required");
    const pending = (await history.read(scope, [accepted.scope.threadId]))[0]!;
    expect(pending.historyCut).not.toBeNull();
    expect(
      evaluateResolutionHistory({
        history: pending,
        parentCreatedAt: "2020-01-01T00:00:00.000Z",
        isResolved: false,
      }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["resolution_effect_unknown"],
    });
    await history.settleLegacy(accepted, "confirmed", new Date());
    const confirmed = (
      await history.read(scope, [accepted.scope.threadId])
    )[0]!;
    expect(confirmed.pending).toEqual([]);
    expect(confirmed.confirmed?.operationId).toBe(accepted.operationId);
    expect(
      evaluateResolutionHistory({
        history: confirmed,
        parentCreatedAt: "2020-01-01T00:00:00.000Z",
        isResolved: false,
      }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["previously_resolved_thread_reopened"],
    });
  });
  it("serializes canonical pending facts and keeps exact own progress independent per thread", async () => {
    await history.beginDrain(scope);
    await history.activate(scope, managedWriterProof());
    const operation = {
      sourceKind: "canonical_operation" as const,
      operationId: "canonical-A",
      publicationAttemptId: "own-publication",
      executionId: "own-execution",
      generation: "1",
      reviewedHeadSha: "a".repeat(40),
      bodyHash: "b".repeat(64),
      state: "may_have_started" as const,
      enteredAt: new Date().toISOString(),
    };
    const target = { ...scope, threadId: "canonical-A" };
    await prisma.$transaction((transaction) =>
      recordPendingResolution(transaction, target, operation),
    );
    await expect(
      prisma.$transaction((transaction) =>
        recordPendingResolution(transaction, target, {
          ...operation,
          operationId: "foreign",
        }),
      ),
    ).rejects.toThrow("resolution_effect_unknown");
    const [first, second] = await history.read(scope, [
      target.threadId,
      "untouched-B",
    ]);
    const byThread = new Map(
      [first!, second!].map((row) => [row.threadId, row]),
    );
    expect(
      evaluateResolutionHistory({
        history: byThread.get(target.threadId)!,
        parentCreatedAt: new Date().toISOString(),
        isResolved: false,
        ownOperation: operation,
      }),
    ).toMatchObject({ status: "own_operation_pending" });
    expect(
      evaluateResolutionHistory({
        history: byThread.get("untouched-B")!,
        parentCreatedAt: "2020-01-01T00:00:00.000Z",
        isResolved: false,
      }),
    ).toMatchObject({
      status: "eligible",
      reasonCodes: ["legacy_history_before_cut_unobserved"],
    });
    await prisma.$transaction((transaction) =>
      settleResolution(
        transaction,
        target,
        operation.operationId,
        "confirmed",
        { effectId: "effect-A", observedAt: new Date().toISOString() },
      ),
    );
    const restored = new PrismaReviewThreadResolutionHistory(prisma);
    const fact = (await restored.read(scope, [target.threadId]))[0]!;
    expect(fact.confirmed?.effectId).toBe("effect-A");
    expect(
      evaluateResolutionHistory({
        history: fact,
        parentCreatedAt: new Date().toISOString(),
        isResolved: false,
        ownOperation: operation,
      }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["previously_resolved_thread_reopened"],
    });
  });
  it("stores a real quarantine cut and atomically blocks old or unknown parents without fabricated pending rows", async () => {
    const id = randomUUID();
    const bootstrapScope = {
      ...scope,
      repositoryConnectionId: `bootstrap-connection-${id}`,
    };
    await prisma.repositoryConnection.create({
      data: {
        id: bootstrapScope.repositoryConnectionId,
        workspaceId: scope.workspaceId,
        scmRepositoryIdentityId: scope.scmRepositoryIdentityId,
        externalRepositoryId: id,
        owner: "history-bootstrap-test",
        name: id,
        fullName: `history-bootstrap-test/${id}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    try {
      const proof = controlledRetiredWriterProof();
      await history.beginDrain(bootstrapScope);
      await expect(
        history.activate(bootstrapScope, {
          ...proof,
          qualificationSource: "managed_executor_handler_settlement.v1",
        } as never),
      ).rejects.toThrow("resolution_writer_quiescence_unqualified");
      await expect(
        history.activate(bootstrapScope, {
          ...proof,
          proofHash: undefined,
        } as never),
      ).rejects.toThrow("resolution_writer_quiescence_unqualified");
      expect(
        (
          await prisma.repositoryConnection.findUniqueOrThrow({
            where: { id: bootstrapScope.repositoryConnectionId },
          })
        ).lifecycleResolutionMode,
      ).toBe("draining");
      await history.activate(bootstrapScope, proof);
      const [old] = await history.read(bootstrapScope, [
        "late-visible-pre-cut",
      ]);
      expect(old!.historyCut?.bootstrap).toMatchObject({
        qualificationSource: "retired_legacy_writers_quarantine.v1",
        executorSetHash: proof.executorSetHash,
        proofHash: proof.proofHash,
      });
      expect(old!.pending).toEqual([]);
      expect(old!.confirmed).toBeNull();
      expect(
        evaluateResolutionHistory({
          history: old!,
          parentCreatedAt: "2020-01-01T00:00:00.000Z",
          isResolved: false,
        }),
      ).toEqual({
        status: "blocked",
        reasonCodes: ["untracked_legacy_possibility"],
      });
      const activationCut = old!.historyCut!.activatedAt;
      const operation = {
        sourceKind: "canonical_operation" as const,
        operationId: "bootstrap-operation",
        publicationAttemptId: "bootstrap-publication",
        executionId: "bootstrap-execution",
        generation: "1",
        reviewedHeadSha: "a".repeat(40),
        bodyHash: "b".repeat(64),
        state: "may_have_started" as const,
        enteredAt: new Date().toISOString(),
      };
      await expect(
        prisma.$transaction((transaction) =>
          recordPendingResolution(
            transaction,
            { ...bootstrapScope, threadId: "old-parent" },
            operation,
            { parentCreatedAt: activationCut },
          ),
        ),
      ).rejects.toThrow("untracked_legacy_possibility");
      await expect(
        prisma.$transaction((transaction) =>
          recordPendingResolution(
            transaction,
            { ...bootstrapScope, threadId: "missing-parent" },
            operation,
          ),
        ),
      ).rejects.toThrow("resolution_parent_creation_unavailable");
      expect(
        await prisma.reviewThreadResolutionGuardV1.count({
          where: {
            repositoryConnectionId: bootstrapScope.repositoryConnectionId,
          },
        }),
      ).toBe(0);
      const postCut = new Date(Date.parse(activationCut) + 1).toISOString();
      expect(
        evaluateResolutionHistory({
          history: { ...old!, threadId: "new-parent" },
          parentCreatedAt: postCut,
          isResolved: false,
        }),
      ).toMatchObject({
        status: "eligible",
        historyStatus: "no_prior_rr_resolution",
      });
      await prisma.$transaction((transaction) =>
        recordPendingResolution(
          transaction,
          { ...bootstrapScope, threadId: "new-parent" },
          operation,
          { parentCreatedAt: postCut },
        ),
      );
      const restored = (
        await new PrismaReviewThreadResolutionHistory(prisma).read(
          bootstrapScope,
          ["new-parent"],
        )
      )[0]!;
      expect(restored.historyCut).toEqual(old!.historyCut);
      expect(restored.pending).toMatchObject([
        { operationId: operation.operationId },
      ]);
    } finally {
      await prisma.repositoryConnection.delete({
        where: { id: bootstrapScope.repositoryConnectionId },
      });
    }
  });
});

function managedWriterProof() {
  return {
    writerDigest: "d".repeat(64),
    qualificationSource: "managed_executor_handler_settlement.v1" as const,
    executors: [
      {
        executorId: "controlled-test-executor",
        binaryDigest: "e".repeat(64),
        acceptsNewRequests: false as const,
        handlerSettlement: "terminal_or_exact_durable_pending" as const,
      },
    ],
  };
}
