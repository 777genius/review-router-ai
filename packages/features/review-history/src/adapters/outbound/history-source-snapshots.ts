import type { ReviewHistoryRun } from "@prisma/client";
import type {
  HistoryRunIdentity,
  HistorySourceSnapshot,
} from "../../domain/history-events";
export type HistoryDisplayMetadata = Readonly<{
  repositoryFullName?: string | null;
  pullRequestTitle?: string | null;
}>;
export type CapturableHistoryIntent = Readonly<{
  historyRootRequestId?: string | null;
  requestId: string;
  dispatchAttempt: number;
  version: bigint;
  workspaceId: string;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  pullRequestNumber: number;
  triggerKind: string;
  revision: Readonly<{ headSha: string; reviewRevisionHash: string }>;
  state: string;
  terminalReason: string | null;
  admission: Readonly<{ state: string }>;
  executionId: string | null;
  updatedAt: Date;
}>;
export type CapturableHistoryExecution = Readonly<{
  historyRootRequestId?: string | null;
  historyDispatchAttempt?: number | null;
  executionId: string;
  version: bigint;
  generation: bigint;
  state: string;
  finalizedArtifactId: string | null;
  updatedAt: Date;
}>;
export type CapturableHistoryCompletion = Readonly<{
  executionId: string;
  processVersion: bigint;
  state: string;
  lastSafeReason: string | null;
  publicationAttemptId: string | null;
  snapshotCommitReceiptId: string | null;
  updatedAt: Date;
}>;
export function identity(row: ReviewHistoryRun): HistoryRunIdentity {
  return {
    rootRequestId: row.rootRequestId,
    pullRequestId: row.pullRequestId,
    workspaceId: row.workspaceId,
    scmRepositoryIdentityId: row.scmRepositoryIdentityId,
    pullRequestNumber: row.pullRequestNumber,
    originalRepositoryConnectionId: row.originalRepositoryConnectionId,
    runSequence: row.runSequence.toString(),
    requestedAt: row.requestedAt.toISOString(),
    triggerKind: row.triggerKind,
    headSha: row.headSha,
    reviewRevisionHash: row.reviewRevisionHash,
    repositoryFullName: row.repositoryFullName,
    pullRequestTitle: row.pullRequestTitle,
    sourceBaseUrl: row.sourceBaseUrl,
  };
}
export function intentSnapshot(
  i: CapturableHistoryIntent,
): Extract<HistorySourceSnapshot, { kind: "intent" }> {
  return {
    kind: "intent",
    sourceId: i.requestId,
    attempt: i.dispatchAttempt,
    sourceVersion: i.version.toString(),
    facts: {
      state: i.state,
      terminalReason: i.terminalReason,
      admissionState: i.admission.state,
      executionId: i.executionId,
    },
  };
}
export function executionSnapshot(
  e: CapturableHistoryExecution,
  attempt: number,
): Extract<HistorySourceSnapshot, { kind: "execution" }> {
  return {
    kind: "execution",
    sourceId: e.executionId,
    attempt,
    sourceVersion: e.version.toString(),
    facts: {
      state: e.state,
      generation: e.generation.toString(),
      finalizedArtifactId: e.finalizedArtifactId,
    },
  };
}
export function completionSnapshot(
  c: CapturableHistoryCompletion,
  attempt: number,
): Extract<HistorySourceSnapshot, { kind: "completion" }> {
  const state =
    c.state === "pending_publication"
      ? "publication_in_progress"
      : c.state === "pending_snapshot"
        ? "awaiting_snapshot"
        : c.state === "blocked_partial"
          ? "partial_completed"
          : c.state;
  return {
    kind: "completion",
    sourceId: c.executionId,
    attempt,
    sourceVersion: c.processVersion.toString(),
    facts: {
      state,
      safeReason: c.lastSafeReason ?? "awaiting_publication",
      publicationAttemptId: c.publicationAttemptId,
      snapshotCommitReceiptId: c.snapshotCommitReceiptId,
    },
  };
}
export function display(
  value: string | null | undefined,
  max: number,
): string | null {
  if (!value) return null;
  const bounded = Array.from(value)
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .trim()
    .slice(0, max);
  const last = bounded.charCodeAt(bounded.length - 1);
  return (
    (last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded) || null
  );
}
