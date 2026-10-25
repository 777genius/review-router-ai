"use server";

import { revalidatePath } from "next/cache";
import { ReviewSkillsError } from "@reviewrouter/features-review-skills";
import type {
  ReviewSkillsInput,
  ReviewSkillsMethod,
  ReviewSkillsResponse,
  ReviewSkillsValue,
} from "../../src/features/review-skills/contracts";
import { getDashboardSignedInActor } from "../../src/server/dashboard-mutations";
import { productionReviewSkills } from "../../src/server/review-skills-composition";
import { enrichReviewSkillsResponse } from "../../src/server/review-skills-response";
import type { ReviewSkillsService } from "@reviewrouter/features-review-skills";

const reads = new Set<string>([
  "loadWorkspaceCapabilities",
  "listWorkspaceSkills",
  "loadSkill",
  "listLinkableSkills",
  "loadSkillAccess",
  "listSkillRepositoryTargets",
  "loadRepositorySkillSettings",
  "listAssignmentChoices",
]);
const methods = new Set<string>([
  ...reads,
  "createSkill",
  "saveSkill",
  "deleteSkill",
  "grantSkill",
  "revokeSkillGrant",
  "acceptSkillGrant",
  "linkSkillAsDualAdmin",
  "unlinkSkill",
  "applyAssignments",
  "updateBindingScope",
  "setRepositorySources",
]);
const messages: Record<string, string> = {
  forbidden:
    "You no longer have permission for this action. Refresh access or change the selection.",
  not_found: "This skill or workspace is unavailable.",
  conflict:
    "The saved version changed. Your draft is preserved; reload the current version before saving again.",
  stale_grant:
    "This access grant changed. Refresh it and accept the current grant.",
  unavailable:
    "A selected skill or repository is unavailable. Remove it from the selection and try again.",
  dependency_exists:
    "Remove repository assignments first. To delete an original, its source workspace administrator must also revoke active sharing grants.",
  limit_exceeded:
    "This operation exceeds a Skills limit. Select up to 1000 repositories and 100 skills; each repository supports up to 32 skills.",
  invalid_input:
    "Check the required fields, sizes, and path patterns, then try again.",
};
export async function executeReviewSkills<
  K extends ReviewSkillsMethod,
>(request: {
  readonly method: K;
  readonly input: ReviewSkillsInput<K>;
}): Promise<ReviewSkillsResponse<ReviewSkillsValue<K>>> {
  if (!request || !methods.has(request.method))
    return {
      status: "error",
      code: "invalid_input",
      message: messages.invalid_input!,
    };
  const actor = await getDashboardSignedInActor();
  if (!actor)
    return {
      status: "error",
      code: "forbidden",
      message: "Sign in to manage review skills.",
    };
  try {
    const service = await productionReviewSkills();
    const operation = service[request.method] as unknown as (
      input: object,
    ) => ReturnType<ReviewSkillsService[K]>;
    const value = await operation.call(service, {
      ...request.input,
      actor: { userId: actor.userId },
    });
    if (!reads.has(request.method)) revalidatePath("/dashboard");
    return {
      status: "ok",
      value: await enrichReviewSkillsResponse(
        request.method,
        request.input,
        value,
      ),
    };
  } catch (error) {
    if (error instanceof ReviewSkillsError)
      return {
        status: "error",
        code: error.code,
        message:
          messages[error.code] ?? "This Skills action could not be completed.",
      };
    // A transport/server failure may happen after commit. Never assert no-change.
    return {
      status: "error",
      code: "unknown",
      message:
        "The result could not be confirmed. Your selection is preserved. Refresh the current state or retry the same action.",
    };
  }
}

/** Identity-only bootstrap; choice queries still authorize every selected repo. */
export async function loadReviewSkillsClientContext(
  workspaceId: string,
): Promise<{ readonly viewerId: string; readonly canCreate: boolean }> {
  const actor = await getDashboardSignedInActor();
  if (!actor) throw new Error("Sign in to manage review skills.");
  const service = await productionReviewSkills();
  try {
    const capabilities = await service.loadWorkspaceCapabilities({
      actor: { userId: actor.userId },
      workspaceId,
    });
    return { viewerId: actor.userId, canCreate: capabilities.canCreate };
  } catch (error) {
    if (error instanceof ReviewSkillsError && error.code === "forbidden")
      return { viewerId: actor.userId, canCreate: false };
    throw error;
  }
}
