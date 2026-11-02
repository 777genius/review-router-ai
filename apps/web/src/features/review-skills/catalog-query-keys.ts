import type { ReviewSkillScanMode } from "./catalog-contracts";

export const skillCatalogKeys = {
  configuration: (viewerId: string, workspaceId: string) =>
    ["skill-catalog", viewerId, workspaceId, "configuration"] as const,
  search: (viewerId: string, workspaceId: string, query: string) =>
    ["skill-catalog", viewerId, workspaceId, "search", query] as const,
  scan: (
    viewerId: string,
    workspaceId: string,
    candidateId: string,
    mode: ReviewSkillScanMode,
    scanId: string,
  ) =>
    [
      "skill-catalog",
      viewerId,
      workspaceId,
      "scan",
      candidateId,
      mode,
      scanId,
    ] as const,
};
