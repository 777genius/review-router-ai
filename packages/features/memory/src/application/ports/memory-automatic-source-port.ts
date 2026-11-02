import type { MemoryActor } from "../../domain/memory-actor";
import type {
  MemoryKnowledgeOperation,
  MemoryKnowledgeScope,
  MemoryKnowledgeSource,
  MemoryEntryRef,
  MemoryAutomaticContextEvidence,
} from "../../domain/memory-knowledge";
import type { MemoryRequestControls } from "./memory-knowledge-provider-port";

export type { MemoryAutomaticSourceBinding } from "../../domain/memory-knowledge";
import type { MemoryAutomaticSourceBinding } from "../../domain/memory-knowledge";
export type MemoryAutomaticSourceInput = {
  readonly processingId: string;
  readonly scope: Extract<MemoryKnowledgeScope, { kind: "repository" }>;
  readonly source: MemoryKnowledgeSource;
  readonly sourceActor: MemoryActor;
  readonly policyRevision: string;
  readonly threadId: string;
  readonly threadDigest: string;
  readonly headSha: string;
  readonly selectableBody: string;
  /** Transient checked chronology; never persisted as provider content. */
  readonly readOnlyContext?: string;
  readonly contextEvidence?: MemoryAutomaticContextEvidence;
  readonly requireConfirmation?: boolean;
  readonly settingsRevision?: string;
};
export type MemoryAutomaticLearningResult = {
  readonly state:
    | "queued"
    | "active"
    | "suppressed"
    | "confirmation_required"
    | "needs_refresh"
    | "unavailable";
  readonly proposals?: readonly string[];
  readonly cohortId: string;
  readonly entryIds: readonly string[];
  readonly operations: readonly MemoryKnowledgeOperation[];
};
export interface AutomaticMemoryLearningPort {
  learn(
    input: MemoryAutomaticSourceInput,
    controls: MemoryRequestControls,
  ): Promise<MemoryAutomaticLearningResult>;
  revoke(
    input: {
      readonly scope: Extract<MemoryKnowledgeScope, { kind: "repository" }>;
      readonly sourceId: string;
      readonly cause: "deleted" | "unavailable" | "changed";
    },
    controls: MemoryRequestControls,
  ): Promise<void>;
}
export type MemoryAutomaticSourceState = {
  readonly scope: Extract<MemoryKnowledgeScope, { kind: "repository" }>;
  readonly sourceId: string;
  readonly suppressed: boolean;
  readonly suppressionEpoch: string;
  readonly entryIds: readonly string[];
} & (
  | {
      readonly binding: MemoryAutomaticSourceBinding;
      readonly sourceUpdatedAt: string;
      readonly source: MemoryKnowledgeSource;
      readonly state: "pending" | "active" | "needs_refresh";
      readonly invalidatedBy?:
        | "changed"
        | "deleted"
        | "unavailable"
        | "delivery_uncertain";
      readonly lastCompleteCohort?: boolean;
    }
  | {
      /** A lineage fence may precede the first selected cohort; it invents no source revision or selection. */
      readonly binding: Pick<
        MemoryAutomaticSourceBinding,
        "lineageKey" | "epoch"
      > & {
        readonly cohortId: null;
        readonly sourceRevision: null;
      };
      readonly sourceUpdatedAt: null;
      readonly source: null;
      readonly state: "unselected";
      readonly invalidatedBy: "deleted";
      readonly lastCompleteCohort: false;
    }
);

export interface MemoryAutomaticSourceStore {
  lookup(
    scope: MemoryKnowledgeScope,
    sourceId: string,
  ): Promise<MemoryAutomaticSourceState | null>;
  lookupLineage(
    scope: MemoryKnowledgeScope,
    lineageKey: string,
  ): Promise<MemoryAutomaticSourceState | null>;
  reserve(input: {
    readonly input: MemoryAutomaticSourceInput;
    readonly generation: string;
    readonly expectedPriorEpoch: string | null;
    readonly entryIds: readonly string[];
    readonly bodyDigests: readonly string[];
    readonly now: Date;
  }): Promise<MemoryAutomaticSourceState>;
  invalidate(input: {
    readonly scope: MemoryKnowledgeScope;
    readonly sourceId: string;
    readonly cause:
      | "deleted"
      | "unavailable"
      | "changed"
      | "delivery_uncertain";
    /** Async observations may withdraw only the exact source cursor they checked. */
    readonly expectedBinding?: MemoryAutomaticSourceBinding;
    readonly now: Date;
  }): Promise<void>;
  recoverAvailability(input: {
    readonly ref: MemoryEntryRef;
    readonly generation: string;
    readonly binding: MemoryAutomaticSourceBinding;
    readonly now: Date;
  }): Promise<boolean>;
  clearSuppression(input: {
    readonly scope: MemoryKnowledgeScope;
    readonly sourceId: string;
    readonly expectedEpoch: string;
    readonly expectedSuppressionEpoch: string;
    readonly automaticSettingsRevision?: string;
    readonly entry?: {
      readonly ref: MemoryEntryRef;
      readonly generation: string;
      readonly expectedRevision: string;
    };
    readonly now: Date;
  }): Promise<void>;
  /** No native/source I/O; locks and verifies the complete activated cohort. */
  applicable(
    ref: MemoryEntryRef,
    generation: string,
    binding: MemoryAutomaticSourceBinding,
  ): Promise<boolean>;
}
/** Product App read checks permission, standing policy, source revision and availability. */
export interface MemoryAutomaticSourceCurrentPort {
  current(
    input: {
      readonly scope: MemoryKnowledgeScope;
      readonly source: MemoryKnowledgeSource;
      readonly binding: Pick<
        MemoryAutomaticSourceBinding,
        | "policyRevision"
        | "sourceActorId"
        | "observedCommitSha"
        | "contextEvidence"
      >;
    },
    controls: MemoryRequestControls,
  ): Promise<boolean>;
}
