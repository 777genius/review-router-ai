import type { MemoryActor } from "../../domain/memory-actor";
import type {
  MemoryKnowledgeScope,
  MemoryKnowledgeSource,
} from "../../domain/memory-knowledge";
import type { MemoryRequestControls } from "./memory-knowledge-provider-port";

/** Implemented by trusted product identity/source adapters, never by a browser assertion. */
export interface MemoryKnowledgeAccessPort {
  authorize(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly action: "read" | "manage" | "export" | "runtime";
    },
    controls: MemoryRequestControls,
  ): Promise<void>;
  verifySource(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly source: MemoryKnowledgeSource;
    },
    controls: MemoryRequestControls,
  ): Promise<MemoryKnowledgeSource>;
  /** Source links and at-commit observations must still be visible/applicable to this consumer. */
  sourceApplicable(
    input: {
      readonly actor: MemoryActor;
      readonly scope: MemoryKnowledgeScope;
      readonly source: MemoryKnowledgeSource;
      readonly consumer: "runtime" | "management" | "export";
    },
    controls: MemoryRequestControls,
  ): Promise<boolean>;
}
