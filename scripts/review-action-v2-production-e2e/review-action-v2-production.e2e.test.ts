import { createHash, randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/platform/db/src/index.js";
import {
  ReviewEvidenceCommitResultStatus,
  ReviewEvidenceLookupResultStatus,
  ReviewExecutionMutationResultStatus,
  ReviewInvocationLeaseResultStatus,
} from "../../packages/protocol-review-action-v2/src/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  reviewStatisticsSettledEventType,
  reviewStatisticsSettledEventVersion,
} from "../../packages/features/review-statistics/src/index.js";
import { createReviewStatisticsFeature } from "../../packages/features/review-statistics/src/composition/index.js";
import { createReviewHistoryFeature } from "../../packages/features/review-history/src/composition/index.js";
import { createReviewStatisticsSettledHandler } from "../../apps/worker/src/review-statistics-worker-runtime.js";
import {
  reviewExecutionFinalizedEventType,
  reviewExecutionFinalizedEventVersion,
} from "../../apps/worker/src/review-v2-worker-runtime.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
  type ReviewActionV2E2EHarness,
} from "./support/review-action-v2-e2e-harness.js";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const enabled = process.env.REVIEW_ROUTER_REVIEW_V2_E2E === "1";
if (enabled && !databaseUrl) {
  throw new Error(
    "REVIEW_ROUTER_TEST_DATABASE_URL is required for review-v2:e2e",
  );
}
const describeWithDatabase = databaseUrl && enabled ? describe : describe.skip;

describeWithDatabase.sequential(
  "Review Action v2 production PostgreSQL E2E and fault recovery",
  () => {
    let harness: ReviewActionV2E2EHarness | null = null;

    beforeEach(async () => {
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      harness = await createReviewActionV2E2EHarness(databaseUrl!);
    });

    afterEach(async () => {
      await harness?.close();
      harness = null;
      await resetReviewActionV2E2EDatabase(databaseUrl!);
    });

    it("adopts a committed observation after provider restart without another semantic attempt", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow({ attachSlotCount: 0 });

      const released = await fixture.releaseProviderLease(flow);
      expect(released.result.status).toBe(
        ReviewInvocationLeaseResultStatus.Applied,
      );
      await expect(
        fixture.prisma.reviewInvocationLeaseV2.findUniqueOrThrow({
          where: { leaseId: flow.leaseId },
          select: { state: true },
        }),
      ).resolves.toEqual({ state: "released" });

      const replay = await fixture.replayCommit(flow);
      expect(replay.result.status).toBe(
        ReviewEvidenceCommitResultStatus.Idempotent,
      );
      expect(replay.result.observationId).toBe(flow.observationId);

      const lookup = await fixture.lookup(flow);
      expect(lookup.result).toMatchObject({
        status: ReviewEvidenceLookupResultStatus.Shadow,
        observationId: flow.observationId,
        payloadHash: flow.payloadHash,
      });
      const adopted = await fixture.adoptCommittedObservation(flow);
      expect(adopted.response.result.status).toBe(
        ReviewExecutionMutationResultStatus.Applied,
      );
      expect(
        JSON.parse(
          requiredString(adopted.response.result.observationFactsCanonicalJson),
        ),
      ).toMatchObject({ observationId: flow.observationId });

      const adoptionReplay = await fixture.replayObservationAdoption(
        adopted.request,
      );
      expect(adoptionReplay.result.status).toBe(
        ReviewExecutionMutationResultStatus.Restored,
      );
      await expectAdoptedExactlyOnce(fixture, flow);

      const finalized = await fixture.finalize(flow);
      expect(finalized.result.status).toBe(
        ReviewExecutionMutationResultStatus.Applied,
      );
      await expect(fixture.processFinalizedOutbox()).resolves.toMatchObject({
        processed: 1,
        deadLettered: 0,
      });
      await fixture.runWorkerUntilSettled();

      await expectTerminalSuccess(fixture, flow.executionId);
      await expectSnapshot(fixture, flow.executionId, true);
      expect(fixture.fakeGitHub.comments).toHaveLength(1);
      expect(fixture.fakeGitHub.checkRuns).toHaveLength(1);

      // Drain the actual accepted settlement separately from finalized-only
      // dispatch, using the genuine registered statistics projector.
      const settlementEvent = await fixture.prisma.outboxEvent.findFirstOrThrow(
        {
          where: {
            workspaceId: fixture.workspaceId,
            aggregateId: flow.executionId,
            type: reviewStatisticsSettledEventType,
            version: reviewStatisticsSettledEventVersion,
          },
        },
      );
      expect(settlementEvent.status).toBe("pending");
      expect(settlementEvent.payload).toMatchObject({
        executionId: flow.executionId,
        repositoryConnectionId: fixture.repositoryConnectionId,
        issues: [], // The real finalized all-clear fixture has no occurrences.
      });
      const statistics = await createReviewStatisticsFeature({
        prisma: fixture.prisma,
      });
      await expect(
        fixture.processFinalizedOutbox({
          handlers: [
            createReviewStatisticsSettledHandler(statistics.projector),
          ],
        }),
      ).resolves.toMatchObject({ processed: 1, deadLettered: 0 });
      await expect(
        fixture.prisma.outboxEvent.findUniqueOrThrow({
          where: { id: settlementEvent.id },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "processed" });
      const actorId = `${fixture.prefix}-statistics-reader`;
      await fixture.prisma.user.create({
        data: {
          id: actorId,
          memberships: {
            create: { workspaceId: fixture.workspaceId, role: "member" },
          },
        },
      });
      try {
        const report = await statistics.reader.readReport({
          actorId,
          workspaceId: fixture.workspaceId,
          filter: { days: 7, severity: "all" },
        });
        expect(report.totals).toEqual({
          reviews: 1,
          pullRequestsReviewed: 1,
          issuesCaught: 0,
          repositoriesWithIssues: 0,
        });
        await expect(
          statistics.reader.readIssues({
            actorId,
            workspaceId: fixture.workspaceId,
            from: report.period.from,
            to: report.period.to,
            severity: "all",
          }),
        ).resolves.toEqual({ items: [], nextCursor: null });
      } finally {
        await fixture.prisma.workspaceMember.deleteMany({
          where: { workspaceId: fixture.workspaceId, userId: actorId },
        });
        await fixture.prisma.user.delete({ where: { id: actorId } });
      }
    }, 60_000);

    it("takes over expired outbox and publication claims with monotonic fencing", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow();
      await fixture.finalize(flow);
      await fixture.forceStaleOutboxClaim();

      await expect(
        fixture.processFinalizedOutbox({ takeoverEnabled: true }),
      ).resolves.toMatchObject({
        recoveredStale: 1,
        processed: 1,
        staleClaims: 0,
      });
      const abandoned = await fixture.forceStalePublicationClaim();
      await fixture.runWorkerUntilSettled();

      const claims = await fixture.prisma.reviewPublicationClaimTermV2.findMany(
        {
          where: { publicationAttemptId: abandoned.publicationAttemptId },
          orderBy: { fencingToken: "asc" },
          select: { claimId: true, fencingToken: true, state: true },
        },
      );
      expect(claims).toHaveLength(2);
      expect(claims[0]).toEqual({
        claimId: abandoned.claimId,
        fencingToken: abandoned.fencingToken,
        state: "expired",
      });
      expect(claims[1]!.fencingToken > abandoned.fencingToken).toBe(true);
      await expectTerminalSuccess(fixture, flow.executionId);
      await expectSnapshot(fixture, flow.executionId, true);
    }, 60_000);

    it("rejects every SCM mutation when the persisted current head moves", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow();
      await fixture.finalize(flow);
      await fixture.processFinalizedOutbox();
      await fixture.movePersistedCurrentRevision({
        headSha: "f".repeat(40),
        reviewRevisionHash: hash("moved-review-revision"),
      });

      await fixture.runWorkerUntilSettled();

      const publication =
        await fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
          where: { executionId: flow.executionId },
        });
      expect(publication.state).toBe("terminal");
      expect(publication.terminalOutcome).toBe("superseded_no_effect");
      expect(fixture.fakeGitHub.comments).toHaveLength(0);
      expect(fixture.fakeGitHub.checkRuns).toHaveLength(0);
      await expectSnapshot(fixture, flow.executionId, false);
    }, 60_000);

    it("fails closed on a live SCM revision race while persisted current revision stays unchanged", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow();
      await fixture.finalize(flow);
      await fixture.processFinalizedOutbox();
      const persistedBefore = await fixture.readPersistedCurrentRevision();
      fixture.setRevision({
        baseSha: persistedBefore.baseSha,
        mergeBaseSha: persistedBefore.mergeBaseSha,
        headSha: "f".repeat(40),
      });

      await fixture.runWorkerUntilSettled();

      await expect(
        fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
          where: { executionId: flow.executionId },
          select: { state: true, terminalOutcome: true },
        }),
      ).resolves.toEqual({
        state: "terminal",
        terminalOutcome: "superseded_no_effect",
      });
      await expect(fixture.readPersistedCurrentRevision()).resolves.toEqual(
        persistedBefore,
      );
      expect(fixture.fakeGitHub.comments).toHaveLength(0);
      expect(fixture.fakeGitHub.checkRuns).toHaveLength(0);
      await expectSnapshot(fixture, flow.executionId, false);
    }, 60_000);

    it("recovers a permanently dead-lettered finalized event and resumes the same process", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow();
      await fixture.finalize(flow);

      await fixture.deadLetterAndRecoverFinalizedEvent();
      await fixture.runWorkerUntilSettled();

      const event = await fixture.prisma.outboxEvent.findFirstOrThrow({
        where: {
          workspaceId: fixture.workspaceId,
          aggregateId: flow.executionId,
          type: reviewExecutionFinalizedEventType,
          version: reviewExecutionFinalizedEventVersion,
        },
      });
      expect(event.status).toBe("processed");
      await expectTerminalSuccess(fixture, flow.executionId);
      await expectSnapshot(fixture, flow.executionId, true);
    }, 60_000);

    it("publishes only the partial summary and never commits a reusable snapshot", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow({
        slotCount: 2,
        attachSlotCount: 1,
      });
      await fixture.finalize(flow, { allowPartial: true });
      await fixture.processFinalizedOutbox();
      await fixture.runWorkerUntilSettled();

      const artifact =
        await fixture.prisma.finalizedReviewProjectionArtifactV2.findUniqueOrThrow(
          { where: { executionId: flow.executionId } },
        );
      const process =
        await fixture.prisma.reviewCompletionProcess.findUniqueOrThrow({
          where: { executionId: flow.executionId },
        });
      expect(artifact.coverageState).toBe("partial");
      expect(process.state).toBe("blocked_partial");
      expect(fixture.fakeGitHub.comments).toHaveLength(1);
      expect(fixture.fakeGitHub.comments[0]?.body).toContain(
        "## Review incomplete - 0 preliminary findings preserved ⚠️",
      );
      expect(fixture.fakeGitHub.comments[0]?.body).toContain(
        "No preliminary findings were preserved",
      );
      expect(fixture.fakeGitHub.comments[0]?.body).toContain("Partial review");
      expect(fixture.fakeGitHub.checkRuns).toHaveLength(0);
      await expect(
        fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
          where: { executionId: flow.executionId },
          select: { state: true, terminalOutcome: true },
        }),
      ).resolves.toEqual({ state: "terminal", terminalOutcome: "succeeded" });
      await expectSnapshot(fixture, flow.executionId, false);
    }, 60_000);

    it("bounds and completes paginated marker reconciliation before creating one canonical summary", async () => {
      const fixture = requiredHarness(harness);
      fixture.fakeGitHub.seedForeignComments(100);
      const flow = await fixture.createCommittedFlow();
      await fixture.finalize(flow);
      await fixture.processFinalizedOutbox();
      await fixture.runWorkerUntilSettled();

      expect(fixture.fakeGitHub.countCalls("GET", `/issues/42/comments`)).toBe(
        4,
      );
      expect(
        fixture.fakeGitHub.comments.filter(
          (comment) => comment.user.login === "reviewrouter-e2e[bot]",
        ),
      ).toHaveLength(1);
      await expectTerminalSuccess(fixture, flow.executionId);
    }, 60_000);

    it("publishes durable 108-file progress, recovers six retried units, and reconciles duplicate comments", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow({
        slotCount: 72,
        eligibleFileCount: 108,
        attachSlotCount: 0,
        pathSlotIndex: (pathIndex) =>
          pathIndex < 84 ? Math.floor(pathIndex / 2) : pathIndex - 42,
        workSlotId: (executionId, slotIndex) =>
          `${executionId}-slot-${String(slotIndex).padStart(3, "0")}`,
      });

      await fixture.setProgressFixture({
        executionId: flow.executionId,
        completed: 42,
        retrying: 6,
        retriedSlotIndexes: [66, 67, 68, 69, 70, 71],
      });
      await fixture.makeProgressDue();
      const initialPublication = await fixture.publishProgress();
      expect(initialPublication).toMatchObject({ published: 1 });
      const comments = progressComments(fixture);
      expect(comments).toHaveLength(1);
      expect(comments[0]?.body).toContain(
        "Review units: 42 of 72 complete (58%)",
      );
      expect(comments[0]?.body).toContain(
        "Files in completed units: 84 of 108",
      );
      expect(comments[0]?.body).toContain("Units currently retrying: 6");

      await fixture.setProgressFixture({
        executionId: flow.executionId,
        completed: 72,
        recovered: 6,
        retriedSlotIndexes: [66, 67, 68, 69, 70, 71],
      });
      await fixture.makeProgressDue();
      const recoveredPublication = await fixture.publishProgress();
      expect(recoveredPublication).toMatchObject({ published: 1 });
      expect(progressComments(fixture)).toHaveLength(1);
      expect(progressComments(fixture)[0]?.body).toContain(
        "Review units: 72 of 72 complete (100%)",
      );
      expect(progressComments(fixture)[0]?.body).toContain(
        "Units recovered by retry: 6",
      );

      fixture.fakeGitHub.seedProgressDuplicate(
        progressComments(fixture)[0]!.body,
      );
      fixture.fakeGitHub.seedProgressDuplicate(
        progressComments(fixture)[0]!.body,
      );
      await fixture.prisma.reviewProgressPublicationV1.updateMany({
        where: { activeExecutionId: flow.executionId },
        data: { publishedVersion: { decrement: 1n } },
      });
      await fixture.makeProgressDue();
      await expect(fixture.publishProgress()).resolves.toMatchObject({
        deferred: 1,
      });
      await fixture.makeProgressDue();
      const result = await fixture.publishProgress();
      expect(
        result,
        JSON.stringify(await fixture.readProgressPublication(), (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ).toMatchObject({ published: 1 });
      expect(progressComments(fixture)).toHaveLength(1);
    }, 60_000);

    it("renders complete with gaps below 100 percent after durable exhaustion", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow({
        slotCount: 4,
        eligibleFileCount: 8,
        attachSlotCount: 0,
      });
      await fixture.setProgressFixture({
        executionId: flow.executionId,
        completed: 3,
      });
      await fixture.terminalizeProgressSlot(flow.executionId, 3);
      await fixture.setExecutionProgressState(flow.executionId, "partial");
      await expect(
        fixture.promoteProgress(flow.executionId, "succeeded"),
      ).resolves.toBe(1);
      await fixture.makeProgressDue();
      await expect(fixture.publishProgress()).resolves.toMatchObject({
        published: 1,
      });
      const body = progressComments(fixture)[0]?.body ?? "";
      expect(body).toContain("**Phase:** Complete with gaps");
      expect(body).toContain("Review units: 3 of 4 complete (75%)");
      expect(body).toContain("Units not completed after retries: 1");
      expect(body).not.toContain("complete (100%)");
    }, 60_000);

    it("finalizes exhausted work without regressing durable progress", async () => {
      const fixture = requiredHarness(harness);
      const flow = await fixture.createCommittedFlow({ attachSlotCount: 0 });

      await fixture.releaseProviderLease(flow);
      await fixture.terminalizeProgressSlot(flow.executionId, 0);
      const finalized = await fixture.finalize(flow, { allowPartial: true });

      expect(finalized.result.status).toBe(
        ReviewExecutionMutationResultStatus.Applied,
      );
      await expect(
        fixture.prisma.reviewExecutionProgressV1.findUniqueOrThrow({
          where: { executionId: flow.executionId },
          select: {
            phase: true,
            requiredExhausted: true,
            requiredCancelled: true,
            terminalOutcome: true,
          },
        }),
      ).resolves.toEqual({
        phase: "assembling",
        requiredExhausted: 1,
        requiredCancelled: 0,
        terminalOutcome: null,
      });
    }, 60_000);

    it("admits a successor over an exhausted active execution", async () => {
      const fixture = requiredHarness(harness);
      const authorization = await fixture.authorize();
      const exhausted = await fixture.createCommittedFlow({
        attachSlotCount: 0,
        authorization,
      });

      await fixture.releaseProviderLease(exhausted);
      await fixture.terminalizeProgressSlot(exhausted.executionId, 0);
      const successor = await fixture.createCommittedFlow({
        attachSlotCount: 0,
        authorization,
      });

      await expect(
        fixture.prisma.reviewExecutionV2.findUniqueOrThrow({
          where: { executionId: exhausted.executionId },
          select: { state: true },
        }),
      ).resolves.toEqual({ state: "superseded" });
      await expect(
        fixture.prisma.reviewExecutionWorkSlotV2.findMany({
          where: { executionId: exhausted.executionId },
          select: { state: true },
        }),
      ).resolves.toEqual([{ state: "exhausted" }]);
      await expect(
        fixture.prisma.reviewExecutionV2.findUniqueOrThrow({
          where: { executionId: successor.executionId },
          select: { state: true },
        }),
      ).resolves.toEqual({ state: "running" });
    }, 60_000);
  },
);

describeWithDatabase.sequential(
  "Review History joined production owners",
  () => {
    it("cleans a failed borrowed History construction without changing its workspace or pre-existing activation", async () => {
      const originalFetch = globalThis.fetch;
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      const setup = createPrismaClient({
        databaseUrl: databaseUrl!,
        poolMax: 2,
      });
      const prefix = `review-v2-history-failure-${randomUUID()}`;
      const workspaceId = `${prefix}-borrowed`,
        foreignId = `${prefix}-foreign`,
        actorId = `${prefix}-actor`;
      const previousHistory = await setup.reviewHistoryCoverage.findUnique({
        where: { id: "capture_v1" },
      });
      const previousStatistics =
        await setup.reviewStatisticsCoverage.findUnique({
          where: { id: "capture_v1" },
        });
      try {
        await setup.workspace.createMany({
          data: [workspaceId, foreignId].map((id) => ({
            id,
            slug: id,
            name: id,
          })),
        });
        await setup.user.create({
          data: {
            id: actorId,
            memberships: { create: { workspaceId, role: "member" } },
          },
        });
        await (
          await createReviewHistoryFeature({ prisma: setup })
        ).activateCapture();
        await (
          await createReviewStatisticsFeature({ prisma: setup })
        ).activateCapture();
        const before = {
          control: await setup.reviewSafetyEmergencyControl.findUniqueOrThrow({
            where: { emergencyControlId: "global-review-v2" },
          }),
          history: await setup.reviewHistoryCoverage.findUniqueOrThrow({
            where: { id: "capture_v1" },
          }),
          statistics: await setup.reviewStatisticsCoverage.findUniqueOrThrow({
            where: { id: "capture_v1" },
          }),
        };
        // This existing worker option is parsed after the real source seed and
        // API composition. It exercises a natural factory failure, without a hook.
        await expect(
          createReviewActionV2E2EHarness(databaseUrl!, {
            historyProfile: true,
            fixtureScope: { prefix, workspaceId },
            environmentOverrides: {
              REVIEW_ROUTER_REVIEW_V2_COMPLETION_CLAIM_MS: "0",
            },
          }),
        ).rejects.toThrow("review_v2_completion_claim_ms_invalid");
        expect(globalThis.fetch).toBe(originalFetch);
        expect(
          await setup.workspace.count({
            where: { id: { in: [workspaceId, foreignId] } },
          }),
        ).toBe(2);
        expect(
          await setup.workspaceMember.count({
            where: { workspaceId, userId: actorId },
          }),
        ).toBe(1);
        expect(
          await setup.repositoryConnection.count({
            where: { id: `${prefix}-repository` },
          }),
        ).toBe(0);
        expect(
          await setup.scmRepositoryIdentity.count({
            where: { scmRepositoryIdentityId: `${prefix}-scm` },
          }),
        ).toBe(0);
        expect(
          await setup.gitHubInstallation.count({
            where: { id: `${prefix}-installation` },
          }),
        ).toBe(0);
        expect(
          await setup.reviewConfiguration.count({ where: { workspaceId } }),
        ).toBe(0);
        expect(
          await setup.workspaceProviderProfile.count({
            where: { workspaceId },
          }),
        ).toBe(0);
        expect(
          await setup.producerRelease.count({
            where: { producerReleaseId: `${prefix}-release` },
          }),
        ).toBe(0);
        expect(
          await setup.reviewProtocolLimitsV2.count({
            where: { protocolLimitsProfileId: `${prefix}-limits` },
          }),
        ).toBe(0);
        expect(
          await setup.reviewOperationalSloProfileV2.count({
            where: { operationalSloProfileId: `${prefix}-slo` },
          }),
        ).toBe(0);
        expect(
          await setup.reviewSafetyPolicy.count({
            where: { policyId: { startsWith: `${prefix}-policy-` } },
          }),
        ).toBe(0);
        expect(
          await setup.reviewSafetyEmergencyControl.findUniqueOrThrow({
            where: { emergencyControlId: "global-review-v2" },
          }),
        ).toEqual(before.control);
        expect(
          await setup.reviewHistoryCoverage.findUniqueOrThrow({
            where: { id: "capture_v1" },
          }),
        ).toEqual(before.history);
        expect(
          await setup.reviewStatisticsCoverage.findUniqueOrThrow({
            where: { id: "capture_v1" },
          }),
        ).toEqual(before.statistics);
        let remainingClients = 1n;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const sessions = await setup.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()`;
          remainingClients = sessions[0]!.count;
          if (remainingClients === 0n) break;
          if (attempt < 19)
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        expect(remainingClients).toBe(0n);
      } finally {
        if (!previousHistory)
          await setup.reviewHistoryCoverage.deleteMany({
            where: { id: "capture_v1" },
          });
        if (!previousStatistics)
          await setup.reviewStatisticsCoverage.deleteMany({
            where: { id: "capture_v1" },
          });
        await setup.user.deleteMany({ where: { id: actorId } });
        await setup.$disconnect();
        await resetReviewActionV2E2EDatabase(databaseUrl!);
      }
    }, 60_000);

    it("captures two manual runs of one SHA through dispatch, publication, the registered queue and authorized reads", async () => {
      const originalFetch = globalThis.fetch;
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      const prefix = `review-v2-history-${randomUUID()}`;
      const workspaceId = `${prefix}-borrowed`;
      const foreignWorkspaceId = `${prefix}-unrelated`;
      const setup = createPrismaClient({
        databaseUrl: databaseUrl!,
        poolMax: 2,
      });
      const originalControl =
        await setup.reviewSafetyEmergencyControl.findUniqueOrThrow({
          where: { emergencyControlId: "global-review-v2" },
        });
      const originalCoverage = await setup.reviewHistoryCoverage.findUnique({
        where: { id: "capture_v1" },
      });
      const originalStatisticsCoverage =
        await setup.reviewStatisticsCoverage.findUnique({
          where: { id: "capture_v1" },
        });
      try {
        await setup.workspace.createMany({
          data: [workspaceId, foreignWorkspaceId].map((id) => ({
            id,
            slug: id,
            name: id,
          })),
        });
      } finally {
        await setup.$disconnect();
      }
      const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
        historyProfile: true,
        fixtureScope: { prefix, workspaceId },
      });
      const actorId = `${fixture.prefix}-history-reader`;
      try {
        expect(globalThis.fetch).toBe(originalFetch);
        await fixture.prisma.user.create({
          data: {
            id: actorId,
            memberships: {
              create: { workspaceId: fixture.workspaceId, role: "member" },
            },
          },
        });
        const history = fixture.history!;
        const list = () =>
          history.reader.listPullRequests({
            actorId,
            workspaceId: fixture.workspaceId,
            filters: { q: "", repositoryId: null, status: "all", days: null },
          });
        const first = await fixture.createHistoryReview("first");
        expect(globalThis.fetch).toBe(originalFetch);
        expect(await list()).toMatchObject({
          items: [
            {
              id: first.pullRequestId,
              status: "queued",
              pullRequestTitle: first.pullRequestTitle,
            },
          ],
          coverage: { state: "available" },
        });
        await fixture.replayHistoryReview(first);
        expect(fixture.fakeGitHub.dispatches).toHaveLength(1);
        expect(
          await fixture.prisma.reviewHistoryRun.count({
            where: { workspaceId: fixture.workspaceId },
          }),
        ).toBe(1);
        const firstFlow = await fixture.startHistoryReview(first);
        expect((await list()).items).toMatchObject([{ status: "running" }]);
        await expect(
          fixture.prisma.reviewExecutionV2.findUniqueOrThrow({
            where: { executionId: firstFlow.executionId },
            select: {
              historyRootRequestId: true,
              historyDispatchAttempt: true,
            },
          }),
        ).resolves.toEqual({
          historyRootRequestId: first.rootRequestId,
          historyDispatchAttempt: 1,
        });
        await fixture.publishHistoryReview(firstFlow);
        expect((await list()).items).toMatchObject([{ status: "publishing" }]);
        expect(fixture.fakeGitHub.comments).toHaveLength(0);
        expect(fixture.fakeGitHub.checkRuns).toHaveLength(0);
        await fixture.completeHistoryReview(firstFlow);
        await expectTerminalSuccess(fixture, firstFlow.executionId);
        expect((await list()).items).toMatchObject([{ status: "completed" }]);
        expect(fixture.fakeGitHub.comments[0]?.user.login).toBe(
          "reviewrouter-e2e[bot]",
        );
        expect(fixture.fakeGitHub.checkRuns).toHaveLength(1);
        const second = await fixture.createHistoryReview("second");
        expect(second.rootRequestId).not.toBe(first.rootRequestId);
        expect(second.headSha).toBe(first.headSha);
        expect(second.pullRequestId).toBe(first.pullRequestId);
        expect((await list()).items).toMatchObject([{ status: "queued" }]);
        const runs = () =>
          history.reader.listRuns({
            actorId,
            workspaceId: fixture.workspaceId,
            pullRequestId: first.pullRequestId,
          });
        expect((await runs()).items).toEqual([
          expect.objectContaining({
            id: second.rootRequestId,
            status: "queued",
          }),
          expect.objectContaining({
            id: first.rootRequestId,
            status: "completed",
          }),
        ]);
        await fixture.replayHistoryReview(first);
        expect((await list()).items).toMatchObject([{ status: "queued" }]);
        const secondFlow = await fixture.startHistoryReview(second);
        expect((await list()).items).toMatchObject([{ status: "running" }]);
        await fixture.publishHistoryReview(secondFlow);
        expect((await list()).items).toMatchObject([{ status: "publishing" }]);
        await fixture.completeHistoryReview(secondFlow);
        expect((await list()).items).toMatchObject([{ status: "completed" }]);
        expect((await runs()).items).toMatchObject([
          { id: second.rootRequestId, status: "completed" },
          { id: first.rootRequestId, status: "completed" },
        ]);
        expect(fixture.fakeGitHub.dispatches).toHaveLength(2);
        expect(
          await fixture.prisma.reviewHistoryRun.count({
            where: { workspaceId: fixture.workspaceId },
          }),
        ).toBe(2);
        expect(
          await fixture.prisma.reviewHistoryPullRequest.count({
            where: { workspaceId: fixture.workspaceId },
          }),
        ).toBe(1);
        const facts = await fixture.prisma.outboxEvent.findMany({
          where: {
            repositoryId: fixture.repositoryConnectionId,
            type: "review.history.changed",
          },
          select: { status: true, payload: true },
        });
        expect(facts.length).toBeGreaterThan(8);
        expect(facts.every((event) => event.status === "processed")).toBe(true);
        expect(globalThis.fetch).toBe(originalFetch);
        await expect(
          history.reader.listPullRequests({
            actorId: `${actorId}-outsider`,
            workspaceId: fixture.workspaceId,
            filters: { q: "", repositoryId: null, status: "all", days: null },
          }),
        ).rejects.toMatchObject({ code: "history_access_denied" });
        await fixture.cleanupHistoryFixtures();
        expect(
          await fixture.prisma.reviewHistoryRun.count({
            where: { workspaceId: fixture.workspaceId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.workspace.count({
            where: { id: { in: [workspaceId, foreignWorkspaceId] } },
          }),
        ).toBe(2);
        expect(
          await fixture.prisma.workspaceMember.count({
            where: { workspaceId, userId: actorId },
          }),
        ).toBe(1);
        expect(
          await fixture.prisma.repositoryConnection.count({
            where: { id: fixture.repositoryConnectionId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.reviewRunAuthorization.count({
            where: { repositoryConnectionId: fixture.repositoryConnectionId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.reviewExecutionV2.count({
            where: { repositoryConnectionId: fixture.repositoryConnectionId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.outboxEvent.count({
            where: { repositoryId: fixture.repositoryConnectionId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.producerRelease.count({
            where: { producerReleaseId: fixture.producerReleaseId },
          }),
        ).toBe(0);
        expect(
          await fixture.prisma.reviewHistoryCoverage.findUnique({
            where: { id: "capture_v1" },
          }),
        ).toEqual(originalCoverage);
        expect(
          await fixture.prisma.reviewStatisticsCoverage.findUnique({
            where: { id: "capture_v1" },
          }),
        ).toEqual(originalStatisticsCoverage);
        expect(
          await fixture.prisma.reviewSafetyEmergencyControl.findUniqueOrThrow({
            where: { emergencyControlId: "global-review-v2" },
          }),
        ).toEqual(originalControl);
      } finally {
        await fixture.prisma.user.deleteMany({ where: { id: actorId } });
        await fixture.close();
        await resetReviewActionV2E2EDatabase(databaseUrl!);
      }
    }, 120_000);
  },
);

function progressComments(fixture: ReviewActionV2E2EHarness) {
  return fixture.fakeGitHub.comments.filter(
    (comment) =>
      comment.user.login === "reviewrouter-e2e[bot]" &&
      comment.body.includes("<!-- review-router-live-progress -->"),
  );
}

async function expectTerminalSuccess(
  fixture: ReviewActionV2E2EHarness,
  executionId: string,
): Promise<void> {
  await expect(
    fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
      where: { executionId },
      select: { state: true, terminalOutcome: true },
    }),
  ).resolves.toEqual({ state: "terminal", terminalOutcome: "succeeded" });
  await expect(
    fixture.prisma.reviewCompletionProcess.findUniqueOrThrow({
      where: { executionId },
      select: { state: true },
    }),
  ).resolves.toEqual({ state: "completed" });
}

async function expectSnapshot(
  fixture: ReviewActionV2E2EHarness,
  executionId: string,
  expected: boolean,
): Promise<void> {
  const count = await fixture.prisma.reviewSnapshot.count({
    where: { sourceExecutionId: executionId },
  });
  expect(count).toBe(expected ? 1 : 0);
}

async function expectAdoptedExactlyOnce(
  fixture: ReviewActionV2E2EHarness,
  flow: Readonly<{
    executionId: string;
    workSlotId: string;
    observationId: string;
    leaseId: string;
  }>,
): Promise<void> {
  const observations = await fixture.prisma.reviewEvidenceObservation.count({
    where: { sourceExecutionId: flow.executionId },
  });
  const providerLeases = await fixture.prisma.reviewInvocationLeaseV2.count({
    where: {
      executionId: flow.executionId,
      purpose: "provider_execution",
    },
  });
  const semanticAttempts = await fixture.prisma.reviewInvocationLeaseV2.count({
    where: { executionId: flow.executionId, attemptId: { not: null } },
  });
  const adoptionLeases = await fixture.prisma.reviewInvocationLeaseV2.count({
    where: {
      executionId: flow.executionId,
      purpose: "observation_adoption",
    },
  });
  const slot = await fixture.prisma.reviewExecutionWorkSlotV2.findUniqueOrThrow(
    {
      where: {
        executionId_workSlotId: {
          executionId: flow.executionId,
          workSlotId: flow.workSlotId,
        },
      },
      select: {
        state: true,
        nextAttemptOrdinal: true,
        acceptedObservationRefId: true,
      },
    },
  );
  expect({
    observations,
    providerLeases,
    semanticAttempts,
    adoptionLeases,
  }).toEqual({
    observations: 1,
    providerLeases: 1,
    semanticAttempts: 1,
    adoptionLeases: 1,
  });
  expect(slot).toMatchObject({
    state: "satisfied",
    nextAttemptOrdinal: 2,
  });
  await expect(
    fixture.prisma.reviewExecutionObservationRefV2.findFirstOrThrow({
      where: {
        observationRefId: slot.acceptedObservationRefId ?? "missing",
      },
      select: {
        observationId: true,
        attachmentKind: true,
        sourceLeaseId: true,
      },
    }),
  ).resolves.toEqual({
    observationId: flow.observationId,
    attachmentKind: "observation_adoption",
    sourceLeaseId: flow.leaseId,
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("review_v2_e2e_string_expected");
  }
  return value;
}

function requiredHarness(
  value: ReviewActionV2E2EHarness | null,
): ReviewActionV2E2EHarness {
  if (!value) throw new Error("review_v2_e2e_harness_missing");
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
