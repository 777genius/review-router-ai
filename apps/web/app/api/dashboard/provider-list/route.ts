import { NextResponse, type NextRequest } from "next/server";
import { getDashboardSignedInActor } from "../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../src/server/prisma";
import { loadProviderListView } from "../../../../src/server/provider-list-view";

export const dynamic = "force-dynamic";

/**
 * The workspace Providers list of the signed-in member: `?workspace=<id>`.
 * The same read as the server-rendered list, refetched after provider writes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspace")?.trim();
  if (!workspaceId)
    return NextResponse.json({ error: "workspace_required" }, { status: 400 });

  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor)
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  try {
    const view = await loadProviderListView({
      prisma: getPrisma(),
      workspaceId,
      actor,
    });
    // Only members read the list; the same answer for an unknown workspace.
    if (!view)
      return NextResponse.json(
        { error: "provider_list_forbidden" },
        { status: 403 },
      );
    return NextResponse.json(view, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "provider_list_unavailable" },
      { status: 500 },
    );
  }
}
