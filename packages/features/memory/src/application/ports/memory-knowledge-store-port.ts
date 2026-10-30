import type {
  MemoryEntryRef,
  MemoryKnowledgeCommand,
  MemoryKnowledgeApproval,
  MemoryKnowledgeEntryMetadata,
  MemoryKnowledgeErrorCode,
  MemoryKnowledgeOperation,
  MemoryKnowledgeScope,
  MemoryAutomaticSourceBinding,
} from "../../domain/memory-knowledge";
import type { MemoryProviderOperation } from "./memory-knowledge-provider-port";
import type {
  MemoryAutomaticSourceStore,
  MemoryAutomaticSourceState,
} from "./memory-automatic-source-port";

export type MemoryStoredCommand = {
  readonly operation: MemoryKnowledgeOperation;
  readonly digest: string;
  readonly envelope: MemoryKnowledgeCommand | null;
  readonly contentApprovalRevision: string;
  readonly originalStatementAt: string | null;
  readonly deliveryExpiresAt: string;
  readonly resubmitUntil: string;
  readonly approval: MemoryKnowledgeApproval;
};

/** Constructed only by a trusted host verifier after execution drain and absence checks. */
export type MemoryVerifiedCleanupReceipt = {
  readonly coverage: "entry_history_and_operations";
  readonly id: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly generation: string;
  readonly ref: MemoryEntryRef;
  readonly verifiedAt: string;
  readonly verifiedBy: string;
  readonly maintenanceEpoch: string;
};

export type MemoryKnowledgeMaintenanceState = {
  readonly generation: string;
  readonly epoch: string;
  readonly paused: boolean;
};

/** All admission/settlement methods are cross-process database transactions. No in-memory leases. */
export interface MemoryKnowledgeStore {
  maintenanceState(
    generation: string,
  ): Promise<MemoryKnowledgeMaintenanceState>;
  setMaintenancePaused(input: {
    readonly generation: string;
    readonly paused: boolean;
    readonly expectedEpoch: string;
    readonly actor: string;
    readonly now: Date;
    readonly deadlineAt: Date;
  }): Promise<MemoryKnowledgeMaintenanceState>;
  /** Shared database permit spans the complete bounded native transport callback. */
  withDeliveryPermit<T>(
    input: {
      readonly generation: string;
      readonly scope: MemoryKnowledgeScope;
      readonly commandId: string;
      readonly claimId: string;
      readonly now: Date;
      readonly deadlineAt: Date;
    },
    work: (permit: { readonly revoked: boolean }) => Promise<T>,
  ): Promise<
    | { readonly permitted: false }
    | { readonly permitted: true; readonly value: T }
  >;
  admit(input: {
    readonly command: MemoryKnowledgeCommand;
    readonly automaticSource?: MemoryAutomaticSourceBinding;
    readonly internalRetirement?: MemoryAutomaticSourceBinding;
    readonly digest: string;
    readonly now: Date;
    readonly deliveryExpiresAt: Date;
    readonly resubmitUntil: Date;
    readonly activeEntryLimit: number | null;
    readonly pendingCommandLimit: number;
  }): Promise<MemoryKnowledgeOperation>;
  /** Cohort cursor, complete frozen envelopes, and outbox records commit together. */
  admitAutomaticSelection(input: {
    readonly reservation: Parameters<MemoryAutomaticSourceStore["reserve"]>[0];
    readonly children: readonly Parameters<MemoryKnowledgeStore["admit"]>[0][];
    readonly retirements: readonly Parameters<
      MemoryKnowledgeStore["admit"]
    >[0][];
  }): Promise<{
    readonly source: MemoryAutomaticSourceState;
    readonly operations: readonly MemoryKnowledgeOperation[];
  }>;
  /** Immutable bodyless child association survives source supersession and envelope expiry. */
  findAutomaticOperations(input: {
    readonly scope: MemoryKnowledgeScope;
    readonly generation: string;
    readonly sourceId: string;
    readonly processingId: string;
  }): Promise<readonly MemoryKnowledgeOperation[]>;
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
  /**
   * Persist unknown before external I/O. Reclaim the same command for observation;
   * its observer may resend the exact envelope only within an explicitly qualified
   * native retention window. Claim expiry itself grants no resubmission authority.
   */
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
  /** Recover IDs-only delivery work into the existing transactional outbox. */
  scheduleDueDeliveries(input: {
    readonly generation: string;
    readonly now: Date;
    readonly limit: number;
  }): Promise<number>;
  listExpiredEntries(input: {
    readonly generation: string;
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly MemoryKnowledgeEntryMetadata[]>;
  /** Atomically closes current Forget and every older unresolved entry operation after verified physical cleanup. */
  completeCleanup(input: {
    readonly receipt: MemoryVerifiedCleanupReceipt;
    readonly now: Date;
  }): Promise<MemoryKnowledgeOperation>;
}
