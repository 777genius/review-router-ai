import type { MemoryActor } from "../../domain/memory-actor";
import type {
  MemoryKnowledgeOperation,
  MemoryKnowledgeScope,
  MemoryKnowledgeSource,
  MemoryEntryRef,
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
  readonly readOnlyContext: string;
};
export type MemoryAutomaticLearningResult = {
  readonly state:
    | "queued"
    | "active"
    | "suppressed"
    | "needs_refresh"
    | "unavailable";
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
  readonly binding: MemoryAutomaticSourceBinding;
  readonly scope: Extract<MemoryKnowledgeScope, { kind: "repository" }>;
  readonly sourceId: string;
  readonly sourceUpdatedAt: string;
  readonly source: MemoryKnowledgeSource;
  readonly state: "pending" | "active" | "needs_refresh";
  readonly suppressed: boolean;
  readonly entryIds: readonly string[];
};
export interface MemoryAutomaticSourceStore {
  lookup(
    scope: MemoryKnowledgeScope,
    sourceId: string,
  ): Promise<MemoryAutomaticSourceState | null>;
  reserve(input: {
    readonly input: MemoryAutomaticSourceInput;
    readonly generation: string;
    readonly entryIds: readonly string[];
    readonly bodyDigests: readonly string[];
    readonly now: Date;
  }): Promise<MemoryAutomaticSourceState>;
  invalidate(input: {
    readonly scope: MemoryKnowledgeScope;
    readonly sourceId: string;
    readonly cause: "deleted" | "unavailable" | "changed";
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
        "policyRevision" | "sourceActorId" | "observedCommitSha"
      >;
    },
    controls: MemoryRequestControls,
  ): Promise<boolean>;
}
