"use server";

import {
  changeProviderAccessRights,
  PrismaWorkspaceReviewSettings,
} from "@reviewrouter/features-review-config";
import {
  recordAuditEvent,
  PrismaAuditLogRepository,
} from "@reviewrouter/features-audit-log";
import {
  assertDashboardMutationAllowed,
  dashboardMutationAccessAuditMetadata,
} from "../../src/server/dashboard-mutations";
import {
  dashboardProviderActor,
  dashboardProviderProfiles,
} from "../../src/server/dashboard-provider-selections";
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

/**
 * Access rights: owners and admins decide whether only they manage provider
 * profiles and selections. Decided by the provider policy under the
 * workspace lock every provider write takes, written with its audit event in
 * one transaction, and only its own column: a stale form of the draft review
 * setting can never reset drafts.
 */
export async function saveWorkspaceAccessRightsClientAction(
  formData: FormData,
): Promise<{ readonly params: Record<string, string> }> {
  const rawWorkspaceId = formData.get("workspaceId");
  const workspaceId =
    typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : "";
  const context = { workspace: workspaceId, section: "other" };
  try {
    const actor = await assertDashboardMutationAllowed(workspaceId);
    const value = formData.get("providerManagementAdminOnly");
    if (value !== null && value !== "on")
      throw new Error("dashboard_action_failed");
    await changeProviderAccessRights(
      {
        workspaceId,
        actor: dashboardProviderActor(actor),
        adminOnly: value === "on",
        auditMetadata: dashboardMutationAccessAuditMetadata(actor),
      },
      { profiles: dashboardProviderProfiles(getPrisma()) },
    );
    return { params: { ...context, notice: "workspace_access_rights_saved" } };
  } catch (error) {
    return { params: { ...context, error: safeDashboardErrorCode(error) } };
  }
}
