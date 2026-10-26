import {
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";

/** Native bank mapping is shared by transport and operator proof verification. */
export function hindsightMemoryBankId(
  config: { readonly namespace: string; readonly generation: string },
  scope: MemoryKnowledgeScope,
): string {
  return `rr-${memoryKnowledgeDigest([config.namespace, config.generation, memoryKnowledgeScopeKey(scope)])}`;
}
