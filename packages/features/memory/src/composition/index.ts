// Server-only composition. Host processes retain ownership of the borrowed DB.
export {
  createMemoryKnowledgeRuntime,
  type MemoryKnowledgeRuntime,
} from "./memory-knowledge-runtime";
export { createConfiguredMemorySourcePreview } from "../infrastructure/hindsight/hindsight-source-preview";
export { parseMemoryProviderConfig } from "../infrastructure/config/memory-provider-config";
export { hindsightMemoryBankId } from "../infrastructure/hindsight/hindsight-scope";
export { createPrismaAutomaticMemorySourceCurrent } from "./automatic-memory-source-current";
export {
  createGitHubAutomaticMemorySourceCurrent,
  type MemorySourceGitHubClient,
} from "../infrastructure/github/github-automatic-memory-source-current";
