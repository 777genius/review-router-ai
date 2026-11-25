import { NextResponse, type NextRequest } from "next/server";
import { getDashboardSignedInActor } from "../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../src/server/prisma";
import {
  loadProviderSetupView,
  ProviderSetupViewError,
} from "../../../../src/server/provider-setup-view";

export const dynamic = "force-dynamic";

/**
 * The provider dialog view of one target: `?workspace=<id>` for the
 * workspace default, plus one `repository=<id>` per fixed repository.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspace")?.trim();
  const repositoryIds = request.nextUrl.searchParams
    .getAll("repository")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!workspaceId)
    return NextResponse.json({ error: "workspace_required" }, { status: 400 });

  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor)
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  try {
    const view = await loadProviderSetupView({
      prisma: getPrisma(),
      workspaceId,
      actor,
      target:
        repositoryIds.length > 0
          ? { kind: "repositories", repositoryIds }
          : { kind: "workspace" },
    });
    return NextResponse.json(view, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ProviderSetupViewError)
      return NextResponse.json(
        { error: error.code },
        {
          status:
            error.code === "provider_setup_forbidden"
              ? 403
              : error.code === "provider_setup_target_invalid"
                ? 400
                : 404,
        },
      );
    return NextResponse.json(
      { error: "provider_setup_unavailable" },
      { status: 500 },
    );
  }
}
