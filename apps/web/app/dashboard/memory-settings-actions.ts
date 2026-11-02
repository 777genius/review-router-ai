"use server";

import { z } from "zod";
import {
  PrismaReviewPolicyHeadReader,
  saveWorkspaceMemorySettings,
} from "@reviewrouter/features-review-config";
import { assertDashboardMutationAllowed } from "../../src/server/dashboard-mutations";
import {
  dashboardProviderActor,
  dashboardReviewConfigurations,
} from "../../src/server/dashboard-provider-selections";
import { getPrisma } from "../../src/server/prisma";
import { safeDashboardErrorCode } from "./dashboard-error-codes";

const formSchema = z
  .object({
    workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
    expectedVersion: z.union([
      z.literal(""),
      z.string().regex(/^[1-9]\d{0,8}$/),
    ]),
    requireConfirmation: z.literal("on").optional(),
  })
  .strict();

export async function saveWorkspaceMemorySettingsClientAction(
  formData: FormData,
): Promise<{
  readonly params: Record<string, string>;
}> {
  const workspaceId =
    typeof formData.get("workspaceId") === "string"
      ? String(formData.get("workspaceId")).trim()
      : "";
  const context = { workspace: workspaceId, section: "memory" };
  try {
    // Server Actions retain the dashboard's existing same-origin CSRF boundary.
    const actor = await assertDashboardMutationAllowed(workspaceId);
    if ([...formData.keys()].some((key) => formData.getAll(key).length !== 1))
      throw new Error("invalid_form_value:memory_settings");
    const parsed = formSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) throw new Error("invalid_form_value:memory_settings");
    const prisma = getPrisma();
    await saveWorkspaceMemorySettings(
      {
        workspaceId: parsed.data.workspaceId,
        actor: dashboardProviderActor(actor),
        requireConfirmation: parsed.data.requireConfirmation === "on",
        expectedVersion:
          parsed.data.expectedVersion === ""
            ? null
            : Number(parsed.data.expectedVersion),
      },
      {
        configurations: dashboardReviewConfigurations(prisma, actor.userId),
        policyHeads: new PrismaReviewPolicyHeadReader(prisma),
      },
    );
    return {
      params: { ...context, notice: "workspace_memory_settings_saved" },
    };
  } catch (error) {
    return { params: { ...context, error: safeDashboardErrorCode(error) } };
  }
}
