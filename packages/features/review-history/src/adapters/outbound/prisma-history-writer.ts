import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ReviewHistoryRun,
} from "@prisma/client";
import {
  HistoryCollisionError,
  historyChangedEventType,
  parseHistoryChangedEvent,
  type HistoryChangedEvent,
  type HistorySourceSnapshot,
} from "../../domain/history-events";
import { historyHash } from "./history-hash";
import {
  identity,
  intentSnapshot,
  executionSnapshot,
  completionSnapshot,
  display,
  type HistoryDisplayMetadata,
  type CapturableHistoryIntent,
  type CapturableHistoryExecution,
  type CapturableHistoryCompletion,
} from "./history-source-snapshots";
type Tx = Prisma.TransactionClient;
export async function activateHistoryCapture(
  prisma: PrismaClient,
): Promise<Date> {
  await prisma.$executeRaw`INSERT INTO "ReviewHistoryCoverage"("id","coverageSince") VALUES ('capture_v1',clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT("id") DO NOTHING`;
  const row = await prisma.reviewHistoryCoverage.findUniqueOrThrow({
    where: { id: "capture_v1" },
  });
  return row.coverageSince;
}
export function createPrismaHistoryWriter() {
  return new PrismaHistoryWriter();
}
export class PrismaHistoryWriter {
  private async active(tx: Tx): Promise<boolean> {
    return (
      (await tx.reviewHistoryCoverage.findUnique({
        where: { id: "capture_v1" },
      })) !== null
    );
  }
  /** Called before any predecessor capture in a winning new-root registration transaction. */
  async register(
    tx: Tx,
    intent: CapturableHistoryIntent,
    metadata: HistoryDisplayMetadata = {},
  ): Promise<void> {
    if (!(await this.active(tx))) return;
    if (intent.historyRootRequestId !== intent.requestId)
      throw new HistoryCollisionError();
    const repository = await tx.repositoryConnection.findUnique({
      where: { id: intent.repositoryConnectionId },
      select: {
        workspaceId: true,
        provider: true,
        sourceBaseUrl: true,
        fullName: true,
      },
    });
    if (
      !repository ||
      repository.workspaceId !== intent.workspaceId ||
      repository.provider !== "github" ||
      repository.sourceBaseUrl !== "https://github.com"
    )
      return;
    const scope = {
      workspaceId: intent.workspaceId,
      scmRepositoryIdentityId: intent.scmRepositoryIdentityId,
      pullRequestNumber: intent.pullRequestNumber,
    };
    await tx.reviewHistoryPullRequest.upsert({
      where: { workspaceId_scmRepositoryIdentityId_pullRequestNumber: scope },
      create: { id: randomUUID(), ...scope },
      update: {},
    });
    const allocated = await tx.$queryRaw<
      Array<{ id: string; lastAllocatedRunSequence: bigint }>
    >`UPDATE "ReviewHistoryPullRequest" SET "lastAllocatedRunSequence"="lastAllocatedRunSequence"+1 WHERE "workspaceId"=${scope.workspaceId} AND "scmRepositoryIdentityId"=${scope.scmRepositoryIdentityId} AND "pullRequestNumber"=${scope.pullRequestNumber} RETURNING "id","lastAllocatedRunSequence"`;
    const pr = allocated[0];
    if (!pr) throw new Error("history_pr_allocation_missing");
    const prior = await tx.reviewHistoryRun.findFirst({
      where: scope,
      orderBy: { runSequence: "desc" },
      select: { repositoryFullName: true, pullRequestTitle: true },
    });
    const [clock] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "now"`;
    if (!clock) throw new Error("history_database_clock_missing");
    const row = await tx.reviewHistoryRun.create({
      data: {
        rootRequestId: intent.requestId,
        pullRequestId: pr.id,
        ...scope,
        originalRepositoryConnectionId: intent.repositoryConnectionId,
        runSequence: pr.lastAllocatedRunSequence,
        requestedAt: clock.now,
        triggerKind: intent.triggerKind,
        headSha: intent.revision.headSha,
        reviewRevisionHash: intent.revision.reviewRevisionHash,
        repositoryFullName: display(
          metadata.repositoryFullName ??
            repository.fullName ??
            prior?.repositoryFullName,
          512,
        ),
        pullRequestTitle: display(
          metadata.pullRequestTitle ?? prior?.pullRequestTitle,
          500,
        ),
        sourceBaseUrl: repository.sourceBaseUrl,
        updatedAt: clock.now,
      },
    });
    await this.write(tx, row, intentSnapshot(intent), intent.updatedAt);
  }
  async captureIntent(
    tx: Tx,
    intent: CapturableHistoryIntent,
    previous?: CapturableHistoryIntent,
  ): Promise<void> {
    if (!intent.historyRootRequestId || !(await this.active(tx))) return;
    let row = await tx.reviewHistoryRun.findUnique({
      where: { rootRequestId: intent.historyRootRequestId },
    });
    if (!row) return;
    const snapshot = intentSnapshot(intent);
    if (
      previous &&
      historyHash(snapshot.facts) ===
        historyHash(intentSnapshot(previous).facts)
    )
      return;
    let executionSeed: HistoryChangedEvent["executionSeed"],
      completionSeed: HistoryChangedEvent["completionSeed"];
    if (intent.state === "dispatched" && intent.executionId) {
      // This gate also serializes completion create/apply before their source mutation.
      const executions = await tx.$queryRaw<
        Array<CapturableHistoryExecution>
      >`SELECT "executionId","historyRootRequestId","historyDispatchAttempt","version","generation","state"::text,"finalizedArtifactId","updatedAt" FROM "ReviewExecutionV2" WHERE "executionId"=${intent.executionId} FOR UPDATE`;
      const execution = executions[0];
      if (
        !execution ||
        execution.historyRootRequestId !== intent.historyRootRequestId ||
        execution.historyDispatchAttempt !== intent.dispatchAttempt
      )
        throw new HistoryCollisionError();
      await tx.$queryRaw`SELECT "rootRequestId" FROM "ReviewHistoryRun" WHERE "rootRequestId"=${row.rootRequestId} FOR UPDATE`;
      row = await tx.reviewHistoryRun.findUniqueOrThrow({
        where: { rootRequestId: row.rootRequestId },
      });
      if (
        row.boundExecutionId !== null &&
        (row.boundExecutionId !== intent.executionId ||
          row.boundDispatchAttempt !== intent.dispatchAttempt)
      )
        throw new HistoryCollisionError();
      await tx.reviewHistoryRun.update({
        where: { rootRequestId: row.rootRequestId },
        data: {
          boundExecutionId: intent.executionId,
          boundDispatchAttempt: intent.dispatchAttempt,
        },
      });
      executionSeed = executionSnapshot(execution, intent.dispatchAttempt);
      const completion = await tx.reviewCompletionProcess.findUnique({
        where: { executionId: intent.executionId },
      });
      if (completion)
        completionSeed = completionSnapshot(completion, intent.dispatchAttempt);
    }
    await this.write(tx, row, snapshot, intent.updatedAt, {
      ...(executionSeed ? { executionSeed } : {}),
      ...(completionSeed ? { completionSeed } : {}),
    });
  }
  async captureExecution(
    tx: Tx,
    execution: CapturableHistoryExecution,
  ): Promise<void> {
    if (
      !execution.historyRootRequestId ||
      !execution.historyDispatchAttempt ||
      !(await this.active(tx))
    )
      return;
    // Queued comes from intent; the admission-link seed introduces authoritative Running.
    if (execution.state === "planned" || execution.state === "running") return;
    const row = await tx.reviewHistoryRun.findUnique({
      where: { rootRequestId: execution.historyRootRequestId },
    });
    if (
      !row ||
      row.boundExecutionId !== execution.executionId ||
      row.boundDispatchAttempt !== execution.historyDispatchAttempt
    )
      return;
    await this.write(
      tx,
      row,
      executionSnapshot(execution, execution.historyDispatchAttempt),
      execution.updatedAt,
    );
  }
  async beforeCompletion(tx: Tx, executionId: string): Promise<void> {
    if (!(await this.active(tx))) return;
    // A real MVCC write makes a stale Serializable admission-link transaction
    // retry with a fresh snapshot. SELECT FOR UPDATE alone cannot refresh it.
    // Logical execution version/state/timestamps are intentionally unchanged.
    await tx.$executeRaw`UPDATE "ReviewExecutionV2" AS execution SET "historyRootRequestId"=execution."historyRootRequestId" WHERE execution."executionId"=${executionId} AND EXISTS (SELECT 1 FROM "ReviewHistoryRun" AS run WHERE run."rootRequestId"=execution."historyRootRequestId")`;
  }
  async captureCompletion(
    tx: Tx,
    completion: CapturableHistoryCompletion,
    previous?: CapturableHistoryCompletion,
  ): Promise<void> {
    if (!(await this.active(tx))) return;
    const execution = await tx.reviewExecutionV2.findUnique({
      where: { executionId: completion.executionId },
      select: { historyRootRequestId: true, historyDispatchAttempt: true },
    });
    if (!execution?.historyRootRequestId || !execution.historyDispatchAttempt)
      return;
    const row = await tx.reviewHistoryRun.findUnique({
      where: { rootRequestId: execution.historyRootRequestId },
    });
    if (
      !row ||
      row.boundExecutionId !== completion.executionId ||
      row.boundDispatchAttempt !== execution.historyDispatchAttempt
    )
      return;
    const snapshot = completionSnapshot(
      completion,
      execution.historyDispatchAttempt,
    );
    if (
      previous &&
      historyHash(snapshot.facts) ===
        historyHash(
          completionSnapshot(previous, execution.historyDispatchAttempt).facts,
        )
    )
      return;
    await this.write(tx, row, snapshot, completion.updatedAt);
  }
  private async write(
    tx: Tx,
    row: ReviewHistoryRun,
    snapshot: HistorySourceSnapshot,
    occurredAt: Date,
    seeds: Pick<HistoryChangedEvent, "executionSeed" | "completionSeed"> = {},
  ): Promise<void> {
    const event = parseHistoryChangedEvent({
      version: 1,
      run: identity(row),
      snapshot,
      occurredAt: occurredAt.toISOString(),
      ...(seeds.executionSeed ? { executionSeed: seeds.executionSeed } : {}),
      ...(seeds.completionSeed ? { completionSeed: seeds.completionSeed } : {}),
    });
    const key = `review-history:v1:${snapshot.kind}:${snapshot.sourceId}:${snapshot.sourceVersion}`;
    const inserted =
      await tx.$executeRaw`INSERT INTO "OutboxEvent"("id","type","version","idempotencyKey","workspaceId","repositoryId","aggregateId","payload","status","attempts","maxAttempts","occurredAt","createdAt","updatedAt") VALUES (${randomUUID()},${historyChangedEventType},1,${key},${row.workspaceId},${row.originalRepositoryConnectionId},${row.rootRequestId},${JSON.stringify(event)}::jsonb,'pending',0,5,${occurredAt},now(),now()) ON CONFLICT("idempotencyKey") DO NOTHING`;
    if (!inserted) {
      const existing = await tx.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      if (
        existing.type !== historyChangedEventType ||
        existing.version !== 1 ||
        historyHash(existing.payload) !== historyHash(event)
      )
        throw new HistoryCollisionError();
    }
  }
}
