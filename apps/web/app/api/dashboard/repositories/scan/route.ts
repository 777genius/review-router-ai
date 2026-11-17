import { NextResponse, type NextRequest } from "next/server";
import { getDashboardWorkspaceScope } from "../../../../../src/server/dashboard-mutations";
import { getPrisma } from "../../../../../src/server/prisma";
import { loadRepositoryScanSnapshot } from "../../../../../src/server/repository-scan";

export const dynamic = "force-dynamic";

/**
 * Repository scan progress of `?workspace=<id>`, polled by the Repositories
 * list while a scan runs. Same read and access rule as the server render:
 * only workspace owners and admins see source installations.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspace")?.trim();
  if (!workspaceId)
    return NextResponse.json({ error: "workspace_required" }, { status: 400 });

  const scope = await getDashboardWorkspaceScope();
  if (scope.kind === "none")
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  if (scope.kind !== "all" && !scope.workspaceIds.includes(workspaceId))
    return NextResponse.json(
      { error: "repository_scan_forbidden" },
      { status: 403 },
    );

  try {
    const snapshot = await loadRepositoryScanSnapshot({
      prisma: getPrisma(),
      workspaceId,
    });
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "repository_scan_unavailable" },
      { status: 500 },
    );
  }
}
