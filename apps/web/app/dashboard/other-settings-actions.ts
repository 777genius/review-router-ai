"use server";

import { PrismaWorkspaceReviewSettings } from "@reviewrouter/features-review-config";
import {
  recordAuditEvent,
  PrismaAuditLogRepository,
} from "@reviewrouter/features-audit-log";
import {
  assertDashboardMutationAllowed,
  dashboardMutationAccessAuditMetadata,
} from "../../src/server/dashboard-mutations";
import { getPrisma } from "../../src/server/prisma";
import { safeDashboardErrorCode } from "./dashboard-error-codes";

export async function saveWorkspaceOtherSettingsClientAction(
  formData: FormData,
): Promise<{ readonly params: Record<string, string> }> {
  const rawWorkspaceId = formData.get("workspaceId");
  const workspaceId =
    typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : "";
  const context = { workspace: workspaceId, section: "other" };
  try {
    const actor = await assertDashboardMutationAllowed(workspaceId);
    const value = formData.get("reviewDraftPullRequests");
    if (value !== null && value !== "on")
      throw new Error("dashboard_action_failed");
    const reviewDraftPullRequests = value === "on";
    const prisma = getPrisma();
    await new PrismaWorkspaceReviewSettings(prisma).save(
      workspaceId,
      reviewDraftPullRequests,
    );
    await recordAuditEvent(
      {
        workspaceId,
        actor: actor.actor,
        action: "workspace.review_settings_saved",
        targetType: "workspace",
        targetId: workspaceId,
        metadata: {
          reviewDraftPullRequests,
          ...dashboardMutationAccessAuditMetadata(actor),
        },
      },
      { auditLog: new PrismaAuditLogRepository(prisma) },
    );
    return {
      params: { ...context, notice: "workspace_review_settings_saved" },
    };
  } catch (error) {
    return { params: { ...context, error: safeDashboardErrorCode(error) } };
  }
}
