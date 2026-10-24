import type { ReviewSkillsService } from "../contracts.js";
export type ReviewSkillsManagementMethod =
  | "listAssignmentChoices"
  | "applyAssignments"
  | "loadRepositorySkillSettings"
  | "updateBindingScope"
  | "setRepositorySources"
  | "listSkillRepositoryTargets";
type Managed<K extends ReviewSkillsManagementMethod> = (
  input: Parameters<ReviewSkillsService[K]>[0],
  scmRepositoryIds: readonly string[],
) => ReturnType<ReviewSkillsService[K]>;
export type ReviewSkillsStore = {
  listRepositoryTargetIds: (
    input: Parameters<ReviewSkillsService["listSkillRepositoryTargets"]>[0],
  ) => Promise<readonly string[]>;
} & Omit<ReviewSkillsService, ReviewSkillsManagementMethod> & {
    [K in ReviewSkillsManagementMethod]: Managed<K>;
  };
