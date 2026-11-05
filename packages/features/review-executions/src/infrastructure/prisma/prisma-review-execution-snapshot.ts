import {
  Prisma,
  ReviewInvocationLeaseStateV2 as PrismaLeaseState,
  type ReviewExecutionV2 as ExecutionRecord,
} from "@prisma/client";
import {
  reviewExecutionAbsoluteMaxWorkSlots,
  type ReviewExecution,
  type ReviewExecutionObservationRef,
  type ReviewExecutionScope,
  type ReviewExecutionSnapshot,
  type ReviewExecutionStream,
  type ReviewInvocationLease,
  type ReviewWorkSlot,
} from "../../domain/review-execution";
import {
  artifactFromRecord,
  executionToDomain,
  leaseToDomain,
  observationRefToDomain,
  scopeWhere,
  streamToDomain,
} from "./prisma-review-execution-mappers";

type Transaction = Prisma.TransactionClient;

// Internal read model: the caller owns the exact interactive transaction.
// No PrismaClient, writes or new transaction can enter this module.
export type AttachmentTarget = {
  readonly stream: ReviewExecutionStream;
  readonly execution: ReviewExecution;
  readonly slot: ReviewWorkSlot;
  readonly existingRefForSlot: ReviewExecutionObservationRef | null;
  readonly existingRefByIdentity: ReviewExecutionObservationRef | null;
};

export async function loadSnapshot(
  transaction: Transaction,
  executionId: string,
): Promise<ReviewExecutionSnapshot | null> {
  const record = await transaction.reviewExecutionV2.findUnique({
    where: { executionId },
  });
  if (record === null) return null;
  const execution = await loadExecution(transaction, record);
  const streamRecord = await transaction.reviewExecutionStreamV2.findFirst({
    where: scopeWhere(record),
  });
  const refs = await transaction.reviewExecutionObservationRefV2.findMany({
    where: { executionId },
    orderBy: { workSlotId: "asc" },
    take: reviewExecutionAbsoluteMaxWorkSlots + 1,
  });
  const leases = await transaction.reviewInvocationLeaseV2.findMany({
    where: {
      executionId,
      state: PrismaLeaseState.active,
    },
    orderBy: { leaseId: "asc" },
    take: reviewExecutionAbsoluteMaxWorkSlots + 1,
  });
  const artifactRecord =
    await transaction.finalizedReviewProjectionArtifactV2.findUnique({
      where: { executionId },
    });
  if (streamRecord === null) {
    throw new Error("review_execution_stream_missing");
  }
  assertBoundedAggregateCollection(refs, "observation_refs");
  assertBoundedAggregateCollection(leases, "active_leases");
  return {
    stream: streamToDomain(streamRecord),
    execution,
    observationRefs: Object.freeze(refs.map(observationRefToDomain)),
    activeLeases: Object.freeze(leases.map(leaseToDomain)),
    artifact:
      artifactRecord === null
        ? null
        : artifactFromRecord(artifactRecord, execution),
  };
}

export async function loadExecution(
  transaction: Transaction,
  record: ExecutionRecord,
): Promise<ReviewExecution> {
  const workSlots = await transaction.reviewExecutionWorkSlotV2.findMany({
    where: { executionId: record.executionId },
    orderBy: { planOrdinal: "asc" },
    take: reviewExecutionAbsoluteMaxWorkSlots + 1,
  });
  assertBoundedAggregateCollection(workSlots, "work_slots");
  return executionToDomain(record, workSlots);
}

export async function loadActiveLeases(
  transaction: Transaction,
  executionId: string,
): Promise<readonly ReviewInvocationLease[]> {
  const records = await transaction.reviewInvocationLeaseV2.findMany({
    where: { executionId, state: PrismaLeaseState.active },
    orderBy: { leaseId: "asc" },
    take: reviewExecutionAbsoluteMaxWorkSlots + 1,
  });
  assertBoundedAggregateCollection(records, "active_leases");
  return records.map(leaseToDomain);
}

export async function loadLease(
  transaction: Transaction,
  leaseId: string,
): Promise<ReviewInvocationLease | null> {
  const record = await transaction.reviewInvocationLeaseV2.findUnique({
    where: { leaseId },
  });
  return record === null ? null : leaseToDomain(record);
}

export async function loadAttachmentTarget(
  transaction: Transaction,
  command: {
    readonly scope: ReviewExecutionScope;
    readonly executionId: string;
    readonly workSlotId: string;
    readonly observationRefId: string;
  },
): Promise<AttachmentTarget | null> {
  const snapshot = await loadSnapshot(transaction, command.executionId);
  if (snapshot === null || !sameScope(snapshot.execution, command.scope)) {
    return null;
  }
  const slot = snapshot.execution.workSlots.find(
    (entry) => entry.workSlotId === command.workSlotId,
  );
  if (slot === undefined) return null;
  const existingRefForSlot =
    await transaction.reviewExecutionObservationRefV2.findFirst({
      where: {
        executionId: command.executionId,
        workSlotId: command.workSlotId,
      },
    });
  const existingRefByIdentity =
    await transaction.reviewExecutionObservationRefV2.findUnique({
      where: { observationRefId: command.observationRefId },
    });
  return {
    stream: snapshot.stream,
    execution: snapshot.execution,
    slot,
    existingRefForSlot:
      existingRefForSlot === null
        ? null
        : observationRefToDomain(existingRefForSlot),
    existingRefByIdentity:
      existingRefByIdentity === null
        ? null
        : observationRefToDomain(existingRefByIdentity),
  };
}

export function sameScope(
  left: ReviewExecutionScope,
  right: ReviewExecutionScope,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.repositoryConnectionId === right.repositoryConnectionId &&
    left.scmRepositoryIdentityId === right.scmRepositoryIdentityId &&
    left.pullRequestNumber === right.pullRequestNumber
  );
}

export function requiredSnapshot(
  snapshot: ReviewExecutionSnapshot | null,
): ReviewExecutionSnapshot {
  if (snapshot === null) throw new Error("review_execution_snapshot_missing");
  return snapshot;
}

function assertBoundedAggregateCollection(
  records: readonly unknown[],
  kind: string,
): void {
  if (records.length > reviewExecutionAbsoluteMaxWorkSlots) {
    throw new Error(`review_execution_unbounded_${kind}`);
  }
}

