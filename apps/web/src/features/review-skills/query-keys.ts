export const reviewSkillsKeys = {
  workspace: (viewerId: string, workspaceId: string) =>
    ["review-skills", viewerId, workspaceId] as const,
  library: (viewerId: string, workspaceId: string, search: string) =>
    ["review-skills", viewerId, workspaceId, "library", search] as const,
  choices: (
    viewerId: string,
    workspaceId: string,
    repositoryIds: readonly string[],
    search: string,
    assignedOnly = false,
  ) =>
    [
      "review-skills",
      viewerId,
      workspaceId,
      "choices",
      [...repositoryIds].sort(),
      search,
      assignedOnly,
    ] as const,
};
