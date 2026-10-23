import type {
  MemoryEntryRef,
  MemoryKnowledgeCommand,
  MemoryKnowledgeEntryMetadata,
  MemoryKnowledgeErrorCode,
  MemoryKnowledgeOperation,
  MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";
import type { MemoryProviderOperation } from "./memory-knowledge-provider-port";

export type MemoryStoredCommand = {
  readonly operation: MemoryKnowledgeOperation;
  readonly digest: string;
  readonly envelope: MemoryKnowledgeCommand | null;
  readonly contentApprovalRevision: string;
  readonly originalStatementAt: string | null;
  readonly deliveryExpiresAt: string;
  readonly resubmitUntil: string;
};

/** All admission/settlement methods are cross-process database transactions. No in-memory leases. */
export interface MemoryKnowledgeStore {
  admit(input: {
    readonly command: MemoryKnowledgeCommand;
    readonly digest: string;
    readonly now: Date;
    readonly deliveryExpiresAt: Date;
    readonly resubmitUntil: Date;
    readonly activeEntryLimit: number | null;
    readonly pendingCommandLimit: number;
  }): Promise<MemoryKnowledgeOperation>;
  findEntry(
    ref: MemoryEntryRef,
    generation: string,
  ): Promise<MemoryKnowledgeEntryMetadata | null>;
  findEntries(
    refs: readonly MemoryEntryRef[],
    generation: string,
  ): Promise<readonly MemoryKnowledgeEntryMetadata[]>;
  listEntries(input: {
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{
    readonly entries: readonly MemoryKnowledgeEntryMetadata[];
    readonly nextCursor: string | null;
  }>;
  scopeEpoch(scope: MemoryKnowledgeScope, generation: string): Promise<string>;
  findCommand(input: {
    readonly commandId: string;
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
  }): Promise<MemoryStoredCommand | null>;
  /** Persist unknown before external I/O. Reclaim of the SAME command only authorizes observation. */
  claim(input: {
    readonly commandId: string;
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
    readonly now: Date;
    readonly claimId: string;
    readonly claimUntil: Date;
  }): Promise<{
    readonly command: MemoryStoredCommand;
    readonly claimId: string;
    readonly mode: "submit" | "observe";
  } | null>;
  settle(input: {
    readonly commandId: string;
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
    readonly claimId: string;
    readonly result: MemoryProviderOperation;
    readonly now: Date;
  }): Promise<MemoryKnowledgeOperation>;
  recordFailure(input: {
    readonly commandId: string;
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
    readonly claimId: string;
    readonly safeReason: MemoryKnowledgeErrorCode;
    readonly now: Date;
  }): Promise<void>;
  expireDeliveryEnvelopes(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<number>;
}
