import { PrismaWorkspaceMemorySettings } from "@reviewrouter/features-review-config";
import {
  canDashboardActorAdminWorkspace,
  getDashboardSignedInActor,
} from "./dashboard-mutations";
import { getPrisma } from "./prisma";

/** Reads the workspace selected by the authenticated dashboard shell, without native memory I/O. */
export async function loadDashboardMemorySettings(workspaceId: string) {
  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor) throw new Error("dashboard_mutation_requires_sign_in");
  const settings = await new PrismaWorkspaceMemorySettings(getPrisma()).read(
    workspaceId,
  );
  const mutationsEnabled =
    process.env.REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS === "1";
  return {
    ...settings,
    mutationsEnabled,
    canEdit:
      mutationsEnabled &&
      (await canDashboardActorAdminWorkspace({ actor, workspaceId })),
  };
}
