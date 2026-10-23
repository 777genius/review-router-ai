import type {
  MemoryKnowledgeMaintenanceState,
  MemoryStoredCommand,
  MemoryVerifiedCleanupReceipt,
} from "./memory-knowledge-store-port";

/** Trusted operator evidence is translated by the selected provider adapter. */
export interface MemoryCleanupProofPort {
  describe(input: {
    readonly command: MemoryStoredCommand;
    readonly maintenance: MemoryKnowledgeMaintenanceState;
  }): unknown;
  verify(input: {
    readonly proof: unknown;
    readonly command: MemoryStoredCommand;
    readonly maintenance: MemoryKnowledgeMaintenanceState;
    readonly now: Date;
  }): MemoryVerifiedCleanupReceipt | null;
}
