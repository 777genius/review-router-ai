import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { PrismaReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/composition";
import {
  ReviewRequestedIntentState,
  ReviewRequestedIntentTerminalReason,
  ReviewRequestedTransitionStatus,
  ReviewRequestedTriggerKind,
  reviewRequestedDispatchCleanupEventType,
} from "@reviewrouter/features-review-executions";
import {
  historyChangedEventType,
  parseHistoryChangedEvent,
  HistoryStatus,
} from "@reviewrouter/features-review-history";
import {
  createReviewHistoryFeature,
  type ReviewHistoryFeature,
} from "@reviewrouter/features-review-history/composition";

const databaseUrl = process.env.REVIEW_ROUTER_CLEANUP_HISTORY_TEST_DATABASE_URL;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
describe.skipIf(!databaseUrl)(
  "cleanup and active history transaction integration",
  () => {
    let prisma: ReturnType<typeof createPrismaClient>;
    let history: ReviewHistoryFeature;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.hostname !== "127.0.0.1" ||
        !/\/test_cleanup_history_[a-z0-9_]+$/u.test(url.pathname)
      )
        throw new Error("owned cleanup-history loopback database required");
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 4 });
      const migrations = await prisma.$queryRaw<
        { count: bigint; latest: string }[]
      >`
      SELECT count(*) AS count,max(migration_name) AS latest FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(migrations).toEqual([
        { count: 155n, latest: "000151_review_history" },
      ]);
      history = await createReviewHistoryFeature({ prisma });
      await history.activateCapture();
    });
    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("keeps history, terminal intent and cleanup atomic, then binds without changing history facts", async () => {
      const requestId = `TEST-cleanup-history-${randomUUID()}`;
      const workspaceId = requestId,
        repositoryConnectionId = `${requestId}-repo`,
        scmRepositoryIdentityId = `${requestId}-scm`,
        now = new Date();
      await prisma.workspace.create({
        data: { id: workspaceId, slug: workspaceId, name: requestId },
      });
      await prisma.scmRepositoryIdentity.create({
        data: {
          scmRepositoryIdentityId,
          provider: "github",
          normalizedSourceBaseUrl: "https://github.com",
          externalRepositoryId: requestId,
          createdAt: now,
        },
      });
      await prisma.repositoryConnection.create({
        data: {
          id: repositoryConnectionId,
          workspaceId,
          provider: "github",
          sourceBaseUrl: "https://github.com",
          externalRepositoryId: requestId,
          scmRepositoryIdentityId,
          owner: "TEST",
          name: requestId,
          fullName: `TEST/${requestId}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
      await prisma.scmRepositoryIdentity.update({
        where: { scmRepositoryIdentityId },
        data: {
          currentWorkspaceId: workspaceId,
          currentRepositoryConnectionId: repositoryConnectionId,
          boundAt: now,
        },
      });
      let failCapture = false;
      const store = new PrismaReviewRequestedIntentStore(prisma, {
        historyCapture: {
          register: (tx, intent, metadata) =>
            history.writer.register(tx, intent, metadata),
          changed: async (tx, intent, previous) => {
            await history.writer.captureIntent(tx, intent, previous);
            if (
              failCapture &&
              intent.state === ReviewRequestedIntentState.Terminal
            )
              throw new Error("injected_history_capture_rollback");
          },
        },
      });
      await store.registerIntent({
        candidate: {
          workspaceId,
          repositoryConnectionId,
          scmRepositoryIdentityId,
          pullRequestNumber: 1,
          requestId,
          revision: {
            headSha: "a".repeat(40),
            baseSha: "b".repeat(40),
            mergeBaseSha: "b".repeat(40),
            reviewRevisionHash: hash(requestId),
          },
          triggerKind: ReviewRequestedTriggerKind.PullRequestSynchronized,
          deliveryIdentityHash: hash(`${requestId}:delivery`),
          canonicalRequestHash: hash(requestId),
          createdAt: now,
          notBefore: now,
          retainUntil: new Date(now.getTime() + 86400000),
        },
      });
      const claimed = await store.claimIntent({
        requestId,
        claimId: randomUUID(),
        ownerIdHash: hash(requestId),
        now,
        claimUntil: new Date(now.getTime() + 30000),
      });
      const claim = claimed.intent!.claim!;
      await store.beginSubmission({
        requestId,
        ...claim,
        now,
        nextResolutionAt: new Date(now.getTime() + 10),
        resolutionDeadlineAt: new Date(now.getTime() + 30),
      });
      const before = (await store.findByRequestId(requestId))!;
      const beforeEvents = await prisma.outboxEvent.findMany({
        where: { aggregateId: requestId },
        orderBy: { id: "asc" },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const command = {
        requestId,
        expectedVersion: before.version,
        sourceRunId: null,
        sourceRunAttempt: null,
        now: new Date(),
        terminalReason:
          ReviewRequestedIntentTerminalReason.DispatchOutcomeUnknown,
        successorCandidate: null,
      };
      failCapture = true;
      await expect(store.recoverDispatch(command)).rejects.toThrow(
        "injected_history_capture_rollback",
      );
      expect(await store.findByRequestId(requestId)).toEqual(before);
      expect(
        await prisma.outboxEvent.findMany({
          where: { aggregateId: requestId },
          orderBy: { id: "asc" },
        }),
      ).toEqual(beforeEvents);
      failCapture = false;
      expect(await store.recoverDispatch(command)).toMatchObject({
        status: ReviewRequestedTransitionStatus.Applied,
      });
      const terminal = (await store.findByRequestId(requestId))!;
      expect(terminal).toMatchObject({
        state: ReviewRequestedIntentState.Terminal,
        historyRootRequestId: requestId,
      });
      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: requestId },
      });
      const cleanup = events.filter(
        (event) => event.type === reviewRequestedDispatchCleanupEventType,
      );
      const historyEvents = events.filter(
        (event) => event.type === historyChangedEventType,
      );
      expect(cleanup).toHaveLength(1);
      expect(historyEvents).toHaveLength(beforeEvents.length + 1);
      expect(cleanup[0]!.payload).toMatchObject({
        sourceRunId: null,
        sourceRunAttempt: null,
      });
      expect(
        historyEvents.some((event) =>
          JSON.stringify(event.payload).includes('"state":"terminal"'),
        ),
      ).toBe(true);
      expect(
        await store.bindCleanupRunTarget({
          requestId,
          expectedVersion: terminal.version,
          sourceRunId: "701",
          sourceRunAttempt: "1",
        }),
      ).toMatchObject({ status: ReviewRequestedTransitionStatus.Applied });
      const bound = (await store.findByRequestId(requestId))!;
      expect(bound.sourceRunId).toBe("701");
      expect(bound.version).toBe(terminal.version + 1n);
      expect(
        await prisma.outboxEvent.count({
          where: { aggregateId: requestId, type: historyChangedEventType },
        }),
      ).toBe(historyEvents.length);
      expect(
        (
          await prisma.outboxEvent.findUniqueOrThrow({
            where: { id: cleanup[0]!.id },
          })
        ).payload,
      ).toEqual(cleanup[0]!.payload);
      expect(
        await store.bindCleanupRunTarget({
          requestId,
          expectedVersion: terminal.version,
          sourceRunId: "701",
          sourceRunAttempt: "1",
        }),
      ).toMatchObject({ status: ReviewRequestedTransitionStatus.Restored });
      expect(
        await prisma.outboxEvent.count({ where: { aggregateId: requestId } }),
      ).toBe(events.length);
      for (const event of historyEvents)
        await history.projector.project(
          parseHistoryChangedEvent(event.payload),
        );
      expect(
        await prisma.reviewHistoryRun.findUniqueOrThrow({
          where: { rootRequestId: requestId },
        }),
      ).toMatchObject({ status: HistoryStatus.Unconfirmed });
    });
  },
);
