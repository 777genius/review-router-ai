import {
  memoryKnowledgeScopeKey,
  type MemoryEntryRef,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeOperationState,
} from "../domain/memory-knowledge";
import type { MemoryStoredCommand } from "./ports/memory-knowledge-store-port";

/** Physical authority columns are checked against their JSON representation. */
export type MemoryCleanupCommandAuthority = {
  readonly id: string;
  readonly generation: string;
  readonly scopeKey: string;
  readonly workspaceId: string;
  readonly entryId: string;
  readonly revision: number;
  readonly commandKind: string;
  readonly digest: string;
  readonly state: string;
};
export type MemoryCleanupEntryAuthority = {
  readonly generation: string;
  readonly scopeKey: string;
  readonly workspaceId: string;
  readonly entryId: string;
  readonly revision: number;
  readonly lifecycle: string;
  readonly pendingCommandId: string | null;
  readonly revocationCommandId: string | null;
  readonly metadata: MemoryKnowledgeEntryMetadata;
};
export const memoryCleanupNonterminalStates: readonly MemoryKnowledgeOperationState[] =
  ["queued", "submitted", "processing", "unknown", "cleanup_pending"];

const revision = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9][0-9]*$/.test(value) &&
  !/[^0-9]/.test(value) &&
  Number.isSafeInteger(Number(value));
const sameRef = (left: MemoryEntryRef, right: MemoryEntryRef): boolean =>
  left.type === "entry" &&
  right.type === "entry" &&
  left.entryId === right.entryId &&
  memoryKnowledgeScopeKey(left.scope) === memoryKnowledgeScopeKey(right.scope);
const nonterminal = (state: string): boolean =>
  memoryCleanupNonterminalStates.includes(
    state as MemoryKnowledgeOperationState,
  );

/**
 * Shared preflight/transaction policy. A historical Forget cannot authorize a
 * physical purge after current authority has advanced to a different revision.
 * Claims are deliberately irrelevant after the trusted physical drain proof.
 */
export function memoryCleanupAuthorityMatches(input: {
  readonly generation: string;
  readonly command: MemoryStoredCommand;
  readonly row: MemoryCleanupCommandAuthority;
  readonly entry: MemoryCleanupEntryAuthority;
  readonly pending: MemoryCleanupCommandAuthority | null;
}): boolean {
  try {
    const { command, row, entry, pending } = input;
    const operation = command.operation;
    const metadata = entry.metadata;
    const ref = operation.ref;
    const scopeKey = memoryKnowledgeScopeKey(ref.scope);
    const bound = (candidate: MemoryCleanupCommandAuthority) =>
      candidate.generation === input.generation &&
      candidate.scopeKey === scopeKey &&
      candidate.workspaceId === ref.scope.workspaceId &&
      candidate.entryId === ref.entryId &&
      Number.isSafeInteger(candidate.revision) &&
      candidate.revision > 0;
    if (
      !bound(row) ||
      row.commandKind !== "forget" ||
      row.id !== operation.id ||
      row.digest !== command.digest ||
      row.state !== operation.state ||
      !revision(operation.revision) ||
      operation.revision !== String(row.revision) ||
      entry.generation !== input.generation ||
      entry.scopeKey !== scopeKey ||
      entry.workspaceId !== ref.scope.workspaceId ||
      entry.entryId !== ref.entryId ||
      entry.revision !== row.revision ||
      !sameRef(metadata.ref, ref) ||
      metadata.generation !== input.generation ||
      !revision(metadata.revision) ||
      metadata.revision !== String(entry.revision) ||
      metadata.lifecycle !== entry.lifecycle ||
      metadata.pendingCommandId !== entry.pendingCommandId ||
      metadata.revocationCommandId !== entry.revocationCommandId
    )
      return false;
    if (operation.state === "completed")
      return (
        entry.lifecycle === "forgotten" &&
        entry.pendingCommandId === null &&
        entry.revocationCommandId === null &&
        metadata.bodyDigest === null &&
        metadata.contentApprovalRevision === null &&
        metadata.topicsDigest === null &&
        metadata.approval === null &&
        metadata.source === null &&
        metadata.originalStatementAt === null &&
        metadata.lastVerifiedAt === null
      );
    if (
      !nonterminal(operation.state) ||
      entry.lifecycle !== "forget_pending" ||
      entry.revocationCommandId !== row.id ||
      !entry.pendingCommandId
    )
      return false;
    if (entry.pendingCommandId === row.id) return true;
    return (
      !!pending &&
      pending.id === entry.pendingCommandId &&
      bound(pending) &&
      pending.revision < row.revision &&
      nonterminal(pending.state)
    );
  } catch {
    return false;
  }
}
