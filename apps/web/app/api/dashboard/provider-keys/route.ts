import { NextResponse, type NextRequest } from "next/server";
import {
  providerApiKeyProviderSchema,
  type ProviderApiKeyProvider,
} from "@reviewrouter/features-provider-setup";
import { assertDashboardWorkspaceAdminAllowed } from "../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../src/server/prisma";
import { PrismaProviderApiKeyStore } from "../../../../src/server/provider-api-keys";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspace")?.trim();
  const providerType = providerApiKeyProviderSchema.safeParse(
    request.nextUrl.searchParams.get("providerType"),
  );
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_required" }, { status: 400 });
  }
  if (!providerType.success) {
    return NextResponse.json(
      { error: "provider_type_invalid" },
      { status: 400 },
    );
  }

  try {
    await assertDashboardWorkspaceAdminAllowed(workspaceId);
    const state = await new PrismaProviderApiKeyStore(getPrisma()).findState({
      workspaceId,
      providerType: providerType.data,
    });
    return NextResponse.json(state, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: dashboardProviderKeyErrorCode(error) },
      { status: providerKeyErrorStatus(error) },
    );
  }
}

export function dashboardProviderKeyErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "provider_key_request_failed";
  if (error.message.startsWith("entitlement_")) return error.message;
  if (error.message.startsWith("workspace_admin_forbidden:")) {
    return "workspace_admin_forbidden";
  }
  switch (error.message) {
    case "dashboard_auth_misconfigured":
    case "dashboard_admin_requires_sign_in":
    case "dashboard_admin_forbidden":
    case "workspace_admin_forbidden":
      return error.message;
    default:
      return "provider_key_request_failed";
  }
}

export function providerKeyErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 500;
  if (error.message.startsWith("entitlement_")) return 403;
  if (error.message.startsWith("workspace_admin_forbidden:")) return 403;
  switch (error.message) {
    case "dashboard_admin_requires_sign_in":
      return 401;
    case "dashboard_admin_forbidden":
    case "workspace_admin_forbidden":
      return 403;
    case "dashboard_auth_misconfigured":
      return 503;
    default:
      return 500;
  }
}
