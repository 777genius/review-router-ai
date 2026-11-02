import {
  HindsightSourcePreview,
  type HindsightPreviewQualification,
} from "context-memory";
import type { MemorySourcePreviewPort } from "../../application/ports/memory-source-preview-port";
import { parseMemoryProviderConfig } from "../config/memory-provider-config";
import { hindsightMemoryBankId } from "./hindsight-scope";
import {
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";

/** Deployment-owned evidence, never supplied by Action requests. No default qualification. */
export function createConfiguredMemorySourcePreview(
  env: Readonly<Record<string, string | undefined>>,
): MemorySourcePreviewPort {
  const unavailable: MemorySourcePreviewPort = {
    preview: async () => ({ status: "unsupported", reason: "unqualified" }),
  };
  const config = parseMemoryProviderConfig(env);
  if (
    config.kind !== "hindsight" ||
    !env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION ||
    !env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION
  )
    return unavailable;
  let qualification: HindsightPreviewQualification;
  try {
    qualification = JSON.parse(
      env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION,
    ) as HindsightPreviewQualification;
  } catch {
    return unavailable;
  }
  return new HindsightSourcePreview({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    qualification,
    mission: env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION,
    bankForScope: (key) => {
      const parts = JSON.parse(key) as [string, string, string];
      const scope: MemoryKnowledgeScope =
        parts[1] === "repository"
          ? {
              kind: "repository",
              workspaceId: parts[0],
              repositoryId: parts[2],
            }
          : parts[1] === "workspace"
            ? { kind: "workspace", workspaceId: parts[0] }
            : {
                kind: "user_preference",
                workspaceId: parts[0],
                userId: parts[2],
              };
      if (memoryKnowledgeScopeKey(scope) !== key)
        throw new Error("invalid_memory_scope");
      return hindsightMemoryBankId(config, scope);
    },
  });
}
