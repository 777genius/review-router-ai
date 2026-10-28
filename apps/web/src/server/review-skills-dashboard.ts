import { productionReviewSkills } from "./review-skills-composition";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { ReviewSkillsError } from "@reviewrouter/features-review-skills";
export async function loadReviewSkillsDashboard(workspaceId: string) {
  const actor = await getDashboardSignedInActor();
  if (!actor) return { status: "signed_out" as const };
  const service = await productionReviewSkills();
  try {
    const input = { actor: { userId: actor.userId }, workspaceId };
    const [capabilities, page] = await Promise.all([
      service.loadWorkspaceCapabilities(input),
      service.listWorkspaceSkills(input),
    ]);
    return {
      status: "ok" as const,
      viewerId: actor.userId,
      capabilities,
      page,
    };
  } catch (error) {
    return {
      status:
        error instanceof ReviewSkillsError && error.code === "forbidden"
          ? ("restricted" as const)
          : ("unavailable" as const),
    };
  }
}
