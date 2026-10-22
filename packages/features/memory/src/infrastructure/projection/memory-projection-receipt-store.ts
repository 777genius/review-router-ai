import type {
  MemoryIndexDeleteInput,
  MemoryIndexDocument,
  MemorySearchIndexInput,
} from "../../application/ports/memory-search-index-port";

/** Durable metadata only. Never persist body, query, credentials or provider errors. */
export type MemoryProjectionRevision = Pick<
  MemoryIndexDocument,
  | "workspaceId"
  | "memoryItemId"
  | "repositoryId"
  | "userId"
  | "scope"
  | "bodyVersion"
  | "bodyHash"
>;

export type MemoryProjectionReceiptState =
  | "reserved"
  | "sent_unknown"
  | "accepted"
  | "indexed"
  | "deleted";

export type MemoryProjectionReceipt = MemoryProjectionRevision & {
  readonly id: string;
  readonly indexIdentity: string;
  readonly sequenceOrdinal: number;
  readonly state: MemoryProjectionReceiptState;
  readonly remoteDocumentId: string | null;
  readonly deleteRequested: boolean;
  /** Computed from canonical active/nonexpired scope and exact body revision. */
  readonly isCurrent: boolean;
};

export type MemoryProjectionSearchScope = Pick<
  MemorySearchIndexInput,
  | "workspaceId"
  | "repositoryId"
  | "userId"
  | "includeUserPrefs"
  | "allowedScopes"
>;

type ReceiptKey = {
  readonly indexIdentity: string;
  readonly receiptId: string;
};

type ReceiptDocument = ReceiptKey & {
  readonly remoteDocumentId: string;
};

/** Shared projection bookkeeping, independent of any engine or SDK DTOs. */
export interface MemoryProjectionReceiptStore {
  /** Startup check only; reserve/admitSend repeat it under their transaction lock. */
  assertCompatibleIndexIdentity(indexIdentity: string): Promise<void>;

  /** Explicit operator drain only; reject retirement while any debt remains. */
  retireIndexIdentity(indexIdentity: string): Promise<void>;

  /** Unique exact-revision reservation with a stable, database-allocated ordinal. */
  reserve(
    input: MemoryProjectionRevision & { readonly indexIdentity: string },
  ): Promise<MemoryProjectionReceipt | null>;

  /**
   * CAS under the identity admission lock; recheck canonical revision/expiry and
   * delete intent. Returns null when dispatch is forbidden. A successful call
   * durably marks sent_unknown before HTTP; repeat admission may retry that same
   * immutable request while it remains current. Never admit a cancelled receipt.
   */
  admitSend(input: ReceiptKey): Promise<MemoryProjectionReceipt | null>;

  /** Bind one native ID; reject rebinding and never clear concurrent delete intent. */
  recordAcknowledgement(
    input: ReceiptDocument,
  ): Promise<MemoryProjectionReceipt>;

  /** Only mark indexed while the native ID, current revision and intent still match. */
  markIndexed(input: ReceiptDocument): Promise<MemoryProjectionReceipt>;

  findByReceiptIds(input: {
    readonly indexIdentity: string;
    readonly receiptIds: readonly string[];
  }): Promise<readonly MemoryProjectionReceipt[]>;

  /** NOT EXISTS over every authorized active/nonexpired exact canonical revision. */
  hasCoverage(input: {
    readonly indexIdentity: string;
    readonly scope: MemoryProjectionSearchScope;
  }): Promise<boolean>;

  /**
   * Mark all matching receipts for deletion. A reserved/never-sent receipt can be
   * atomically cancelled here; sent_unknown absence is never terminal evidence.
   */
  requestDeletion(
    input: MemoryIndexDeleteInput & { readonly indexIdentity: string },
  ): Promise<void>;

  listForDeletion(
    input: MemoryIndexDeleteInput & {
      readonly indexIdentity: string;
      readonly limit: number;
    },
  ): Promise<readonly MemoryProjectionReceipt[]>;

  /** Pending work and orphan/superseded receipts, ordered fairly by due time. */
  listDue(input: {
    readonly indexIdentity: string;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly MemoryProjectionReceipt[]>;

  /** Operator drain inventory, including current indexed projections. */
  listOutstanding(input: {
    readonly indexIdentity: string;
    readonly limit: number;
  }): Promise<readonly MemoryProjectionReceipt[]>;

  /** Only a known native document's confirmed tombstone may settle a sent write. */
  markDeleted(input: ReceiptDocument): Promise<void>;

  /** Preserve state/intent and schedule another bounded attempt; codes are fixed. */
  defer(
    input: ReceiptKey & {
      readonly nextAttemptAt: Date;
      readonly reasonCode:
        | "memory_index_pending"
        | "memory_index_unavailable"
        | "memory_index_conflict"
        | "memory_index_unknown_write";
    },
  ): Promise<void>;
}
