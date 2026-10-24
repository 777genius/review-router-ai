// Server-only composition. Host processes retain ownership of the borrowed DB.
export {
  createMemoryKnowledgeRuntime,
  type MemoryKnowledgeRuntime,
} from "./memory-knowledge-runtime";
