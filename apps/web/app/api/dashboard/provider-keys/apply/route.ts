import { NextResponse } from "next/server";
import { PrismaAuditLogRepository } from "@reviewrouter/features-audit-log";
import {
  assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository,
} from "@reviewrouter/features-entitlements";
import {
  applyProviderApiKey,
  providerApiKeyProviderSchema,
  ProviderApiKeyUnavailableError,
} from "@reviewrouter/features-provider-setup";
import { requireGitHubAppPrivateKey } from "@reviewrouter/platform-config";
import { z } from "zod";
import { assertDashboardWorkspaceAdminAllowed } from "../../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../../src/server/prisma";
import { createProviderApiKeyServiceDependencies } from "../../../../../src/server/provider-api-keys";

export const dynamic = "force-dynamic";

const applyProviderApiKeyRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    providerType: providerApiKeyProviderSchema,
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(16 * 1024)
      .optional(),
    repositoryIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "json_invalid" }, { status: 400 });
  }
  const parsed = applyProviderApiKeyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "request_invalid" }, { status: 400 });
  }

  try {
    const actor = await assertDashboardWorkspaceAdminAllowed(
      parsed.data.workspaceId,
    );
    const prisma = getPrisma();
    await assertWorkspaceFeatureEntitlement(
      {
        workspaceId: parsed.data.workspaceId,
        feature: "provider_key_management",
        actor: actor.actor,
      },
      {
        entitlements: new PrismaEntitlementRepository(prisma),
        auditLog: new PrismaAuditLogRepository(prisma),
      },
    );
    const result = await applyProviderApiKey(
      {
        workspaceId: parsed.data.workspaceId,
        providerType: parsed.data.providerType,
        ...(parsed.data.apiKey ? { apiKey: parsed.data.apiKey } : {}),
        repositoryIds: parsed.data.repositoryIds,
      },
      createProviderApiKeyServiceDependencies({
        prisma,
        githubAppId: requireGitHubAppId(),
        githubAppPrivateKey: requireGitHubAppPrivateKey(),
      }),
    );
    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: applyProviderApiKeyErrorCode(error) },
      { status: applyProviderApiKeyErrorStatus(error) },
    );
  }
}

function requireGitHubAppId(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  if (!appId) throw new Error("github_app_id_not_configured");
  return appId;
}

function applyProviderApiKeyErrorCode(error: unknown): string {
  if (error instanceof ProviderApiKeyUnavailableError) return error.message;
  if (!(error instanceof Error)) return "provider_key_apply_failed";
  if (error.message.startsWith("entitlement_")) return error.message;
  if (error.message.startsWith("workspace_admin_forbidden:")) {
    return "workspace_admin_forbidden";
  }
  switch (error.message) {
    case "dashboard_auth_misconfigured":
    case "dashboard_admin_requires_sign_in":
    case "dashboard_admin_forbidden":
    case "workspace_admin_forbidden":
    case "github_app_id_not_configured":
    case "github_app_private_key_not_configured":
    case "missing_env:GITHUB_APP_PRIVATE_KEY":
    case "provider_key_request_failed":
      return error.message;
    case "missing_env:REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY":
      return "provider_key_storage_not_configured";
    default:
      return "provider_key_apply_failed";
  }
}

function applyProviderApiKeyErrorStatus(error: unknown): number {
  if (error instanceof ProviderApiKeyUnavailableError) return 400;
  if (!(error instanceof Error)) return 500;
  if (error.message.startsWith("entitlement_")) return 403;
  if (error.message.startsWith("workspace_admin_forbidden:")) return 403;
  switch (error.message) {
    case "dashboard_admin_requires_sign_in":
      return 401;
    case "dashboard_admin_forbidden":
    case "workspace_admin_forbidden":
      return 403;
    case "github_app_id_not_configured":
    case "github_app_private_key_not_configured":
    case "missing_env:GITHUB_APP_PRIVATE_KEY":
    case "dashboard_auth_misconfigured":
    case "provider_key_storage_not_configured":
      return 503;
    default:
      return 500;
  }
}
