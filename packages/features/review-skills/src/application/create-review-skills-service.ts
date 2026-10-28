import {
  parseReviewSkillScope,
  reviewSkillsLimits,
} from "@reviewrouter/shared/review-skills-contract";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode as Code,
} from "../domain/errors.js";
import type {
  ReviewSkillContent,
  ReviewSkillsRepositoryAccessPort,
  ReviewSkillsService,
} from "./contracts.js";
import type { ReviewSkillsStore } from "./ports/review-skills-store.js";

export function validateReviewSkillContent(
  content: ReviewSkillContent,
): ReviewSkillContent {
  if (
    !content ||
    typeof content.name !== "string" ||
    typeof content.description !== "string" ||
    typeof content.instructions !== "string" ||
    !content.name.trim() ||
    !content.instructions.trim() ||
    Array.from(content.name).length > reviewSkillsLimits.nameCharacters ||
    Array.from(content.description).length >
      reviewSkillsLimits.descriptionCharacters ||
    new TextEncoder().encode(content.instructions).byteLength >
      reviewSkillsLimits.instructionsBytes ||
    Object.values(content).some(
      (v) =>
        v.includes("\0") ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          v,
        ),
    )
  )
    throw new ReviewSkillsError(Code.InvalidInput);
  return {
    name: content.name.trim(),
    description: content.description,
    instructions: content.instructions,
  };
}
export function normalizeSkillScope(value: unknown) {
  try {
    return parseReviewSkillScope(value);
  } catch {
    throw new ReviewSkillsError(Code.InvalidInput);
  }
}
function mutationIdentity(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new ReviewSkillsError(Code.InvalidInput);
  return value;
}
export function exactIds(
  ids: readonly string[],
  maximum: number,
): readonly string[] {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > maximum ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id),
    )
  )
    throw new ReviewSkillsError(
      ids?.length > maximum ? Code.LimitExceeded : Code.InvalidInput,
    );
  return [...new Set(ids)].sort();
}
export function createReviewSkillsService(
  store: ReviewSkillsStore,
  access: ReviewSkillsRepositoryAccessPort,
): ReviewSkillsService {
  const authorize = async (
    input: { actor: { userId: string }; workspaceId: string },
    ids: readonly string[],
  ) => {
    if (!ids.length) return [];
    const checked = await access.authorizeRepositoryManagement({
      ...input,
      repositoryIds: ids,
    });
    if (checked.some((id) => !ids.includes(id)))
      throw new ReviewSkillsError(Code.Forbidden);
    return checked;
  };
  return {
    loadWorkspaceCapabilities: (i) => store.loadWorkspaceCapabilities(i),
    listWorkspaceSkills: (i) => store.listWorkspaceSkills(i),
    loadSkill: (i) => store.loadSkill(i),
    createSkill: (i) =>
      store.createSkill({
        ...i,
        createOperationId: mutationIdentity(i.createOperationId),
        content: validateReviewSkillContent(i.content),
      }),
    saveSkill: (i) =>
      store.saveSkill({ ...i, content: validateReviewSkillContent(i.content) }),
    deleteSkill: (i) => store.deleteSkill(i),
    listLinkableSkills: (i) => store.listLinkableSkills(i),
    grantSkill: (i) => store.grantSkill(i),
    revokeSkillGrant: (i) => store.revokeSkillGrant(i),
    acceptSkillGrant: (i) => store.acceptSkillGrant(i),
    linkSkillAsDualAdmin: (i) => store.linkSkillAsDualAdmin(i),
    unlinkSkill: (i) => store.unlinkSkill(i),
    loadSkillAccess: (i) => store.loadSkillAccess(i),
    listSkillRepositoryTargets: async (i) => {
      const candidates = await store.listRepositoryTargetIds(i),
        selected = candidates.slice(0, 50);
      const page = await store.listSkillRepositoryTargets(
        i,
        await authorize(i, selected),
      );
      return {
        ...page,
        nextCursor: candidates.length > 50 ? selected[49]! : null,
      };
    },
    loadRepositorySkillSettings: async (i) =>
      store.loadRepositorySkillSettings(
        i,
        await authorize(i, [i.repositoryId]),
      ),
    listAssignmentChoices: async (i) => {
      const repositoryIds = exactIds(i.repositoryIds, 1000);
      if (i.assignedOnly !== undefined && typeof i.assignedOnly !== "boolean")
        throw new ReviewSkillsError(Code.InvalidInput);
      return store.listAssignmentChoices(
        { ...i, repositoryIds },
        await authorize(i, repositoryIds),
      );
    },
    applyAssignments: async (i) => {
      const repositoryIds = exactIds(i.repositoryIds, 1000),
        skillIds = exactIds(i.skillIds, 100);
      if (i.mode !== "add" && i.mode !== "remove")
        throw new ReviewSkillsError(Code.InvalidInput);
      return store.applyAssignments(
        {
          ...i,
          repositoryIds,
          skillIds,
          ...(i.scope ? { scope: normalizeSkillScope(i.scope) } : {}),
        },
        await authorize(i, repositoryIds),
      );
    },
    updateBindingScope: async (i) =>
      store.updateBindingScope(
        {
          ...i,
          expectedGeneration: mutationIdentity(i.expectedGeneration),
          scope: normalizeSkillScope(i.scope),
        },
        await authorize(i, [i.repositoryId]),
      ),
    setRepositorySources: async (i) => {
      if (
        !Array.isArray(i.roots) ||
        i.roots.length > 2 ||
        new Set(i.roots).size !== i.roots.length ||
        i.roots.some(
          (r) => r !== ".reviewrouter/skills" && r !== ".agents/skills",
        )
      )
        throw new ReviewSkillsError(Code.InvalidInput);
      return store.setRepositorySources(
        i,
        await authorize(i, [i.repositoryId]),
      );
    },
  };
}
