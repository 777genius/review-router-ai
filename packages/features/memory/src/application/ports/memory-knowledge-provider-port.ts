import type {
  MemoryEntryRef,
  MemoryKnowledgeCommand,
  MemoryKnowledgeErrorCode,
  MemoryKnowledgeKind,
  MemoryKnowledgeScope,
  MemoryObservationRef,
} from "../../domain/memory-knowledge";

/** Every nested native request shares this absolute deadline; no per-call budget reset. */
export type MemoryRequestControls = {
  readonly deadlineAt: Date;
  readonly signal?: AbortSignal;
};
export type MemoryProviderEntry = {
  readonly ref: MemoryEntryRef;
  readonly body: string;
  readonly bodyDigest: string;
  readonly contentApprovalRevision: string;
  readonly kind: MemoryKnowledgeKind;
  readonly topicIds: readonly string[];
  readonly statementAt: string;
  readonly sourceFactIds: readonly string[];
};
export type MemoryProviderRecallItem =
  | { readonly type: "entry"; readonly entry: MemoryProviderEntry }
  | {
      readonly type: "observation";
      readonly ref: MemoryObservationRef;
      readonly body: string;
      readonly sourceEntries: readonly MemoryEntryRef[];
      readonly evidenceComplete: boolean;
      readonly temporalStatus: "historical";
    };

export interface MemoryKnowledgeReader {
  read(
    ref: MemoryEntryRef,
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderEntry | null>;
  list(
    input: {
      readonly scope: MemoryKnowledgeScope;
      readonly limit: number;
      readonly cursor?: string;
      readonly topicId?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<{
    readonly entries: readonly MemoryProviderEntry[];
    readonly nextCursor: string | null;
  }>;
  recall(
    input: {
      readonly scope: MemoryKnowledgeScope;
      readonly query: string;
      readonly limit: number;
      readonly includeHistoricalObservations: boolean;
    },
    controls: MemoryRequestControls,
  ): Promise<readonly MemoryProviderRecallItem[]>;
}

export type MemoryProviderOperation = {
  readonly commandId: string;
  readonly state:
    | "submitted"
    | "processing"
    | "published"
    | "failed"
    | "unknown"
    | "cleanup_pending"
    | "completed";
  readonly safeReason?: MemoryKnowledgeErrorCode;
  /** Published save/topics requires qualified body/topic/time readback, not parent status alone. */
  readonly verifiedEntry?: MemoryProviderEntry;
  /** Cleanup completion only after qualified operator pause/drain/absence/restart proof. */
  readonly cleanupReceiptId?: string;
  /** Failed is terminal only when the adapter proved no child can mutate later. */
  readonly executionSettled?: boolean;
};

export interface MemoryKnowledgeWriter {
  submit(
    input: {
      readonly command: MemoryKnowledgeCommand;
      readonly revision: string;
      readonly contentApprovalRevision: string;
      readonly originalStatementAt: string | null;
      readonly allowResubmit: boolean;
      readonly resubmitUntil: string;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderOperation>;
}
export interface MemoryOperationObserver {
  observe(
    input: {
      readonly command: MemoryKnowledgeCommand;
      readonly revision: string;
      readonly contentApprovalRevision: string;
      readonly originalStatementAt: string | null;
      readonly allowResubmit: boolean;
      readonly resubmitUntil: string;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryProviderOperation>;
}
export interface MemoryCandidatePreview {
  preview(
    input: {
      readonly scope: MemoryKnowledgeScope;
      readonly approvedDistilledInput: string;
      readonly maxCandidates: number;
    },
    controls: MemoryRequestControls,
  ): Promise<
    readonly { readonly body: string; readonly kind: MemoryKnowledgeKind }[]
  >;
}
