import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createPrismaClient } from "@reviewrouter/platform-db";
import {
  DispatchDueReviewRequestedIntents,
  ReviewRequestedDispatchLookupStatus,
  ReviewRequestedDispatchRunStatus,
  ReviewRequestedDispatchSubmissionStatus,
  ReviewRequestedIntentState,
  ReviewRequestedTriggerKind,
} from "@reviewrouter/features-review-executions";
import { PrismaReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/composition";
import { InMemoryReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/testing";
import { ProductionHostedReviewPreleaseGate } from "./hosted-review-prelease-gate.js";

// Only point this at an isolated disposable database with the required schema.
const databaseUrl =
  process.env.REVIEW_ROUTER_DISPATCH_ADMISSION_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function prismaFailure(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("fixture key 40001", {
    code,
    clientVersion: "test",
    ...(meta ? { meta } : {}),
  });
}

describe("recordDispatch transaction retry policy", () => {
  it.each([
    { label: "P2034", error: prismaFailure("P2034"), attempts: 3 },
    { label: "P2028", error: prismaFailure("P2028"), attempts: 1 },
    {
      label: "raw serialization",
      error: prismaFailure("P2010", { code: "40001" }),
      attempts: 3,
    },
    {
      label: "raw deadlock",
      error: prismaFailure("P2010", { code: "40P01" }),
      attempts: 3,
    },
    {
      label: "adapter serialization",
      error: prismaFailure("P2010", {
        driverAdapterError: {
          cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
        },
      }),
      attempts: 3,
    },
    {
      label: "adapter SQLSTATE with N/A outer code",
      error: prismaFailure("P2010", {
        code: "N/A",
        driverAdapterError: {
          cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
        },
      }),
      attempts: 3,
    },
    {
      label: "adapter deadlock",
      error: prismaFailure("P2010", {
        driverAdapterError: { cause: { originalCode: "40P01" } },
      }),
      attempts: 3,
    },
    {
      label: "false SQLSTATE in message",
      error: prismaFailure("P2010", {
        code: "23505",
        message: "duplicate key 40001",
      }),
      attempts: 1,
    },
    {
      label: "conflicting SQLSTATE",
      error: prismaFailure("P2010", {
        code: "23505",
        driverAdapterError: { cause: { originalCode: "40001" } },
      }),
      attempts: 1,
    },
    {
      label: "adapter write conflict",
      error: Object.assign(new Error("adapter"), {
        name: "DriverAdapterError",
        cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
      }),
      attempts: 3,
    },
    {
      label: "adapter conflicting code",
      error: Object.assign(new Error("adapter"), {
        name: "DriverAdapterError",
        cause: { kind: "TransactionWriteConflict", originalCode: "08006" },
      }),
      attempts: 1,
    },
  ])("bounds retries for $label", async ({ error, attempts }) => {
    const transaction = vi.fn().mockRejectedValue(error);
    const store = new PrismaReviewRequestedIntentStore({
      reviewRequestedIntent: { findUnique: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never);
    const now = new Date();
    await expect(
      store.recordDispatch({
        requestId: "request",
        claimId: "claim",
        ownerIdHash: "a".repeat(64),
        fencingToken: 1n,
        sourceRunId: "123",
        sourceRunAttempt: "1",
        now,
        nextResolutionAt: new Date(now.getTime() + 1000),
        resolutionDeadlineAt: new Date(now.getTime() + 300000),
      }),
    ).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(attempts);
  });

  it("does not retry a Prisma unique violation", async () => {
    const transaction = vi.fn().mockRejectedValue(prismaFailure("P2002"));
    const store = new PrismaReviewRequestedIntentStore({
      reviewRequestedIntent: { findUnique: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never);
    const now = new Date();
    await expect(
      store.recordDispatch({
        requestId: "request",
        claimId: "claim",
        ownerIdHash: "a".repeat(64),
        fencingToken: 1n,
        sourceRunId: "123",
        sourceRunAttempt: "1",
        now,
        nextResolutionAt: new Date(now.getTime() + 1000),
        resolutionDeadlineAt: new Date(now.getTime() + 300000),
      }),
    ).resolves.toEqual({ status: "stale_claim" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unknown transaction failure", async () => {
    const failure = new Error("unknown transaction outcome");
    const transaction = vi.fn().mockRejectedValue(failure);
    const store = new PrismaReviewRequestedIntentStore({
      reviewRequestedIntent: { findUnique: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never);
    const now = new Date();
    await expect(
      store.recordDispatch({
        requestId: "request",
        claimId: "claim",
        ownerIdHash: "a".repeat(64),
        fencingToken: 1n,
        sourceRunId: "123",
        sourceRunAttempt: "1",
        now,
        nextResolutionAt: new Date(now.getTime() + 1000),
        resolutionDeadlineAt: new Date(now.getTime() + 300000),
      }),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not retry a domain stale claim", async () => {
    const transaction = vi.fn().mockResolvedValue({ status: "stale_claim" });
    const store = new PrismaReviewRequestedIntentStore({
      reviewRequestedIntent: { findUnique: vi.fn().mockResolvedValue({}) },
      $transaction: transaction,
    } as never);
    const now = new Date();
    await expect(
      store.recordDispatch({
        requestId: "request",
        claimId: "claim",
        ownerIdHash: "a".repeat(64),
        fencingToken: 1n,
        sourceRunId: "123",
        sourceRunAttempt: "1",
        now,
        nextResolutionAt: new Date(now.getTime() + 1000),
        resolutionDeadlineAt: new Date(now.getTime() + 300000),
      }),
    ).resolves.toEqual({ status: "stale_claim" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it.each(["P2034", "P2028"])(
    "retries begin only after proven rollback (%s)",
    async (code) => {
      const failure = prismaFailure(code);
      const transaction = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ status: "applied" });
      const store = new PrismaReviewRequestedIntentStore({
        $transaction: transaction,
      } as never);
      const now = new Date();
      const result = store.beginSubmission({
        requestId: "request",
        claimId: "claim",
        ownerIdHash: "a".repeat(64),
        fencingToken: 1n,
        now,
        nextResolutionAt: new Date(now.getTime() + 1000),
        resolutionDeadlineAt: new Date(now.getTime() + 300000),
      });
      if (code === "P2034")
        await expect(result).resolves.toEqual({ status: "applied" });
      else await expect(result).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(code === "P2034" ? 2 : 1);
    },
  );

  it("does not POST after an unknown begin outcome", async () => {
    const store = new InMemoryReviewRequestedIntentStore();
    const now = new Date();
    await store.registerIntent({
      candidate: {
        requestId: "unknown-begin",
        workspaceId: "workspace",
        repositoryConnectionId: "repository",
        scmRepositoryIdentityId: "identity",
        pullRequestNumber: 41,
        revision: {
          baseSha: "a".repeat(40),
          mergeBaseSha: "b".repeat(40),
          headSha: "c".repeat(40),
          reviewRevisionHash: "d".repeat(64),
        },
        triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
        deliveryIdentityHash: "e".repeat(64),
        canonicalRequestHash: "f".repeat(64),
        notBefore: now,
        createdAt: now,
        retainUntil: new Date(now.getTime() + 86400000),
      },
    });
    const failure = prismaFailure("P2028");
    vi.spyOn(store, "beginSubmission").mockRejectedValue(failure);
    const submit = vi.fn();
    const dispatcher = new DispatchDueReviewRequestedIntents(
      store,
      store,
      {
        async prepare() {
          return { submit };
        },
        async findByRequestIdentity() {
          return { status: ReviewRequestedDispatchLookupStatus.Absent };
        },
        async inspectKnownRun() {
          return { status: ReviewRequestedDispatchRunStatus.Pending };
        },
        async inspectRunnerWait() {
          return {
            waitingForRunner: false,
            neverStarted: false,
            revisionCurrent: true,
          };
        },
        async cancelKnownRun() {},
      },
      { now: () => now },
      { nextClaimId: randomUUID, nextRequestId: randomUUID },
      {
        async digestUtf8(value) {
          return digest(value);
        },
      },
    );
    await expect(
      dispatcher.execute({ ownerIdHash: "a".repeat(64), limit: 1 }),
    ).resolves.toMatchObject({ failed: 1 });
    expect(submit).not.toHaveBeenCalled();
  });
});

describePostgres("dispatch to hosted admission on PostgreSQL", () => {
  it.each([
    { requestCount: 2, blocked: "post" },
    { requestCount: 2, blocked: "begin" },
    { requestCount: 2, blocked: "record" },
    { requestCount: 3, blocked: "post" },
    { requestCount: 12, blocked: "post" },
  ] as const)(
    "admits a fast runner during $requestCount PRs with slow $blocked",
    async ({ requestCount, blocked }) => {
      if (!databaseUrl) throw new Error("disposable_database_required");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const suffix = randomUUID();
      const workspaceId = `dispatch-admission-${suffix}`;
      const repositoryId = `repository-${suffix}`;
      const scmRepositoryIdentityId = `identity-${suffix}`;
      const fastId = `fast-${suffix}`;
      const slowId = `slow-${suffix}`;
      const extras = Array.from(
        { length: requestCount - 2 },
        (_, index) => [`extra-${index}-${suffix}`, index + 43] as const,
      );
      const headSha = "c".repeat(40);
      const now = new Date();
      const clock = { now: () => new Date() };
      const store = new PrismaReviewRequestedIntentStore(prisma);
      const postCalls = { fast: 0, slow: 0 };
      const extraPosts = new Map<string, number>();
      const repository = {
        workspaceId,
        repositoryId,
        githubRepositoryId: "123456",
        githubInstallationId: "789",
        fullName: "test/disposable",
        owner: "test",
        selected: true,
        installationStatus: "active",
      };
      const gate = new ProductionHostedReviewPreleaseGate({
        requestedIntentQueries: store,
        requestedIntentCommands: store,
        pullRequests: {
          async resolve() {
            return {
              pullRequestNumber: 41,
              headSha,
              additions: 10,
              deletions: 5,
            };
          },
        },
        clock,
        maxChangedLines: 250_000,
      });
      let runnerAdmission: ReturnType<typeof gate.evaluate> | undefined;
      let signalFast!: () => void;
      const fastStarted = new Promise<void>((resolve) => {
        signalFast = resolve;
      });
      let releaseSlow!: () => void;
      const slowPost = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      let signalSlow!: () => void;
      const slowStarted = new Promise<void>((resolve) => {
        signalSlow = resolve;
      });
      if (blocked === "begin") {
        const begin = store.beginSubmission.bind(store);
        vi.spyOn(store, "beginSubmission").mockImplementation(
          async (command) => {
            if (command.requestId === slowId) {
              signalSlow();
              await slowPost;
            }
            return begin(command);
          },
        );
      }
      if (blocked === "record") {
        const record = store.recordDispatch.bind(store);
        vi.spyOn(store, "recordDispatch").mockImplementation(
          async (command) => {
            if (command.requestId === slowId) {
              signalSlow();
              await slowPost;
            }
            return record(command);
          },
        );
      }
      let pass:
        | ReturnType<DispatchDueReviewRequestedIntents["execute"]>
        | undefined;
      try {
        await prisma.$executeRaw`INSERT INTO "Workspace" ("id", "slug", "name", "updatedAt") VALUES (${workspaceId}, ${workspaceId}, ${workspaceId}, ${now})`;
        await prisma.scmRepositoryIdentity.create({
          data: {
            scmRepositoryIdentityId,
            provider: "github",
            normalizedSourceBaseUrl: "https://github.com",
            externalRepositoryId: suffix,
            createdAt: now,
          },
        });
        await prisma.$executeRaw`INSERT INTO "RepositoryConnection" ("id", "workspaceId", "provider", "sourceBaseUrl", "externalRepositoryId", "scmRepositoryIdentityId", "owner", "name", "fullName", "defaultBranch", "visibility", "updatedAt") VALUES (${repositoryId}, ${workspaceId}, 'github'::"ScmProvider", ${"https://github.com"}, ${suffix}, ${scmRepositoryIdentityId}, ${"test"}, ${suffix}, ${`test/${suffix}`}, ${"main"}, 'private'::"RepositoryVisibility", ${now})`;
        for (const [requestId, pullRequestNumber] of [
          [fastId, 41],
          [slowId, 42],
          ...extras,
        ] as const) {
          await store.registerIntent({
            candidate: {
              workspaceId,
              repositoryConnectionId: repositoryId,
              scmRepositoryIdentityId,
              pullRequestNumber,
              requestId,
              revision: {
                baseSha: "a".repeat(40),
                mergeBaseSha: "b".repeat(40),
                headSha,
                reviewRevisionHash: digest(requestId),
              },
              triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
              deliveryIdentityHash: digest(`delivery-${requestId}`),
              canonicalRequestHash: digest(`canonical-${requestId}`),
              notBefore: new Date(
                now.getTime() -
                  (blocked === "record" && requestId === slowId ? 2000 : 1000),
              ),
              createdAt: new Date(
                now.getTime() -
                  (blocked === "record" && requestId === slowId ? 2000 : 1000),
              ),
              retainUntil: new Date(now.getTime() + 86400000),
            },
          });
        }
        let recoveryTransactions = 0;
        let recoveryRollbackInjected = false;
        let recoveryCommand:
          | Parameters<typeof store.recoverDispatch>[0]
          | undefined;
        let fastRecordTransactions = 0;
        let fastRollbackInjected = false;
        if (requestCount === 2 && blocked === "post") {
          const failure = prismaFailure("P2034");
          const injectingClient = new Proxy(prisma, {
            get(target, property, receiver) {
              if (property !== "$transaction")
                return Reflect.get(target, property, receiver);
              return async (
                callback: (
                  transaction: Prisma.TransactionClient,
                ) => Promise<unknown>,
              ) => {
                fastRecordTransactions += 1;
                if (fastRollbackInjected)
                  return target.$transaction(callback, {
                    isolationLevel:
                      Prisma.TransactionIsolationLevel.Serializable,
                  });
                try {
                  return await target.$transaction(
                    async (transaction) => {
                      await callback(transaction);
                      fastRollbackInjected = true;
                      throw failure;
                    },
                    {
                      isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                    },
                  );
                } catch (error) {
                  if (error !== failure) throw error;
                  await expect(
                    store.findByRequestId(fastId),
                  ).resolves.toMatchObject({
                    state: ReviewRequestedIntentState.ReconcilingDispatch,
                    sourceRunId: null,
                  });
                  throw error;
                }
              };
            },
          });
          const retryStore = new PrismaReviewRequestedIntentStore(
            injectingClient,
          );
          const record = store.recordDispatch.bind(store);
          vi.spyOn(store, "recordDispatch").mockImplementation((command) =>
            command.requestId === fastId
              ? retryStore.recordDispatch(command)
              : record(command),
          );
        }
        if (requestCount === 3) {
          const failure = prismaFailure("P2034");
          const [rejectedId] = extras[0]!;
          const injectingClient = new Proxy(prisma, {
            get(target, property, receiver) {
              if (property !== "$transaction")
                return Reflect.get(target, property, receiver);
              return async (
                callback: (
                  transaction: Prisma.TransactionClient,
                ) => Promise<unknown>,
              ) => {
                recoveryTransactions += 1;
                if (recoveryRollbackInjected)
                  return target.$transaction(callback, {
                    isolationLevel:
                      Prisma.TransactionIsolationLevel.Serializable,
                  });
                try {
                  return await target.$transaction(
                    async (transaction) => {
                      await callback(transaction);
                      recoveryRollbackInjected = true;
                      throw failure;
                    },
                    {
                      isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                    },
                  );
                } catch (error) {
                  if (error !== failure) throw error;
                  await expect(
                    store.findByRequestId(rejectedId),
                  ).resolves.toMatchObject({
                    state: ReviewRequestedIntentState.ReconcilingDispatch,
                  });
                  await expect(
                    store.findPendingByScope({
                      workspaceId,
                      repositoryConnectionId: repositoryId,
                      scmRepositoryIdentityId,
                      pullRequestNumber: 43,
                    }),
                  ).resolves.toBeNull();
                  throw error;
                }
              };
            },
          });
          const retryStore = new PrismaReviewRequestedIntentStore(
            injectingClient,
          );
          const recover = store.recoverDispatch.bind(store);
          vi.spyOn(store, "recoverDispatch").mockImplementation((command) => {
            if (command.requestId !== rejectedId) return recover(command);
            recoveryCommand = command;
            return retryStore.recoverDispatch(command);
          });
        }
        const dispatcher = new DispatchDueReviewRequestedIntents(
          store,
          store,
          {
            async prepare({ intent }) {
              return {
                async submit() {
                  if (intent.requestId === fastId) {
                    postCalls.fast += 1;
                    if (blocked === "record") await slowStarted;
                    // Simulate the runner reaching the real gate as soon as GitHub returns its run id.
                    runnerAdmission = gate.evaluate({
                      repository,
                      sourceRunId: "123456789",
                      sourceRunAttempt: "1",
                      intentRequired: true,
                      now: clock.now(),
                    });
                    signalFast();
                    return {
                      status: ReviewRequestedDispatchSubmissionStatus.Accepted,
                      sourceRunId: "123456789",
                      sourceRunAttempt: "1",
                    };
                  }
                  if (intent.requestId !== slowId) {
                    extraPosts.set(
                      intent.requestId,
                      (extraPosts.get(intent.requestId) ?? 0) + 1,
                    );
                    if (intent.pullRequestNumber === 43) {
                      return {
                        status:
                          ReviewRequestedDispatchSubmissionStatus.DefinitelyNoEffect,
                      };
                    }
                    return {
                      status: ReviewRequestedDispatchSubmissionStatus.Accepted,
                      sourceRunId: String(200000000 + intent.pullRequestNumber),
                      sourceRunAttempt: "1",
                    };
                  }
                  postCalls.slow += 1;
                  if (blocked === "post") {
                    signalSlow();
                    await slowPost;
                  }
                  return {
                    status: ReviewRequestedDispatchSubmissionStatus.Accepted,
                    sourceRunId: "987654321",
                    sourceRunAttempt: "1",
                  };
                },
              };
            },
            async findByRequestIdentity() {
              return { status: ReviewRequestedDispatchLookupStatus.Absent };
            },
            async inspectKnownRun() {
              return { status: ReviewRequestedDispatchRunStatus.Pending };
            },
            async inspectRunnerWait() {
              return {
                waitingForRunner: false,
                neverStarted: false,
                revisionCurrent: true,
              };
            },
            async cancelKnownRun() {},
          },
          clock,
          { nextClaimId: randomUUID, nextRequestId: randomUUID },
          {
            async digestUtf8(value) {
              return digest(value);
            },
          },
        );
        pass = dispatcher.execute({ ownerIdHash: digest(suffix), limit: 20 });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("admission_waited_for_neighbor")),
              3000,
            );
          });
          await Promise.race([
            Promise.all([fastStarted, slowStarted]),
            deadline,
          ]);
          expect(runnerAdmission).toBeDefined();
          await expect(
            Promise.race([runnerAdmission!, deadline]),
          ).resolves.toMatchObject({ status: "admitted" });
        } finally {
          clearTimeout(timeout);
        }
        await expect(store.findByRequestId(fastId)).resolves.toMatchObject({
          state: ReviewRequestedIntentState.AwaitingAuthorization,
          sourceRunId: "123456789",
          admission: { state: "admitted", changedLines: 15 },
        });
        await expect(store.findByRequestId(slowId)).resolves.toMatchObject({
          state:
            blocked === "begin"
              ? ReviewRequestedIntentState.Dispatching
              : ReviewRequestedIntentState.ReconcilingDispatch,
          sourceRunId: null,
        });
        expect(postCalls).toEqual({
          fast: 1,
          slow: blocked === "begin" ? 0 : 1,
        });
        releaseSlow();
        await expect(pass).resolves.toMatchObject({
          dispatched: requestCount > 2 ? requestCount - 1 : 2,
          failed: 0,
        });
        expect(postCalls).toEqual({ fast: 1, slow: 1 });
        if (requestCount === 2 && blocked === "post") {
          expect(fastRollbackInjected).toBe(true);
          expect(fastRecordTransactions).toBeGreaterThanOrEqual(2);
        }
        expect([...extraPosts.values()]).toEqual(
          Array(requestCount - 2).fill(1),
        );
        if (requestCount > 2) {
          const [rejectedId] = extras[0]!;
          await expect(
            store.findByRequestId(rejectedId),
          ).resolves.toMatchObject({
            state: ReviewRequestedIntentState.Superseded,
          });
          await expect(
            store.findPendingByScope({
              workspaceId,
              repositoryConnectionId: repositoryId,
              scmRepositoryIdentityId,
              pullRequestNumber: 43,
            }),
          ).resolves.toMatchObject({
            state: ReviewRequestedIntentState.PendingDispatch,
            dispatchAttempt: 2,
          });
          if (requestCount === 3) {
            expect(recoveryRollbackInjected).toBe(true);
            expect(recoveryTransactions).toBeGreaterThanOrEqual(2);
            expect(recoveryCommand).toBeDefined();
            await expect(
              store.recoverDispatch(recoveryCommand!),
            ).resolves.toMatchObject({ status: "conflict" });
            expect(
              await prisma.reviewRequestedIntent.count({
                where: {
                  workspaceId,
                  pullRequestNumber: 43,
                  state: "pending_dispatch",
                },
              }),
            ).toBe(1);
          }
        }
        if (requestCount === 2 && blocked === "post") {
          for (const competingRecovery of [false, true]) {
            const requestId = `rollback-${competingRecovery}-${suffix}`;
            const at = clock.now();
            await store.registerIntent({
              candidate: {
                workspaceId,
                repositoryConnectionId: repositoryId,
                scmRepositoryIdentityId,
                pullRequestNumber: competingRecovery ? 51 : 50,
                requestId,
                revision: {
                  baseSha: "a".repeat(40),
                  mergeBaseSha: "b".repeat(40),
                  headSha,
                  reviewRevisionHash: digest(requestId),
                },
                triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
                deliveryIdentityHash: digest(`delivery-${requestId}`),
                canonicalRequestHash: digest(`canonical-${requestId}`),
                notBefore: at,
                createdAt: at,
                retainUntil: new Date(at.getTime() + 86400000),
              },
            });
            const claimed = await store.claimIntent({
              requestId,
              claimId: randomUUID(),
              ownerIdHash: digest(suffix),
              now: at,
              claimUntil: new Date(at.getTime() + 60000),
            });
            if (!claimed.intent?.claim)
              throw new Error("fixture_claim_missing");
            const claim = claimed.intent.claim;
            const command = {
              requestId,
              claimId: claim.claimId,
              ownerIdHash: claim.ownerIdHash,
              fencingToken: claim.fencingToken,
              now: at,
              nextResolutionAt: new Date(at.getTime() + 30000),
              resolutionDeadlineAt: new Date(at.getTime() + 300000),
            };
            expect((await store.beginSubmission(command)).status).toBe(
              "applied",
            );
            const before = await store.findByRequestId(requestId);
            const failure = prismaFailure("P2034");
            let transactions = 0;
            const injectingClient = new Proxy(prisma, {
              get(target, property, receiver) {
                if (property !== "$transaction")
                  return Reflect.get(target, property, receiver);
                return async (
                  callback: (
                    transaction: Prisma.TransactionClient,
                  ) => Promise<unknown>,
                ) => {
                  transactions += 1;
                  if (transactions > 1)
                    return target.$transaction(callback, {
                      isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                    });
                  try {
                    return await target.$transaction(
                      async (transaction) => {
                        await callback(transaction);
                        throw failure;
                      },
                      {
                        isolationLevel:
                          Prisma.TransactionIsolationLevel.Serializable,
                      },
                    );
                  } catch (error) {
                    if (error !== failure) throw error;
                    expect(
                      await store.findByRequestId(requestId),
                    ).toMatchObject({
                      state: ReviewRequestedIntentState.ReconcilingDispatch,
                      version: before?.version,
                      sourceRunId: null,
                    });
                    if (competingRecovery) {
                      expect(
                        (
                          await store.recordDispatch({
                            ...command,
                            sourceRunId: "999999999",
                            sourceRunAttempt: "1",
                          })
                        ).status,
                      ).toBe("applied");
                    }
                    throw error;
                  }
                };
              },
            });
            const retryStore = new PrismaReviewRequestedIntentStore(
              injectingClient,
            );
            const attemptedRunId = competingRecovery
              ? "555555556"
              : "555555555";
            const recorded = await retryStore.recordDispatch({
              ...command,
              sourceRunId: attemptedRunId,
              sourceRunAttempt: "1",
            });
            expect(transactions).toBe(2);
            expect(recorded.status).toBe(
              competingRecovery ? "stale_claim" : "applied",
            );
            await expect(
              store.findByRequestId(requestId),
            ).resolves.toMatchObject({
              state: ReviewRequestedIntentState.AwaitingAuthorization,
              version: before!.version + 1n,
              sourceRunId: competingRecovery ? "999999999" : attemptedRunId,
            });
          }
        }
      } finally {
        releaseSlow();
        if (pass) await pass;
        await prisma.reviewRequestedIntent.deleteMany({
          where: { workspaceId },
        });
        await prisma.repositoryConnection.deleteMany({
          where: { id: repositoryId },
        });
        await prisma.scmRepositoryIdentity.deleteMany({
          where: { scmRepositoryIdentityId },
        });
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        await prisma.$disconnect();
      }
    },
    10000,
  );
});
