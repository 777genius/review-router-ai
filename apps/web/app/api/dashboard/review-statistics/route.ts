import { NextResponse, type NextRequest } from "next/server";
import {
  loadStatisticsReport,
  readStatisticsFilter,
  statisticsErrorStatus,
} from "../../../../src/server/review-statistics";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const workspaceId = params.get("workspaceId");
  if (!workspaceId)
    return NextResponse.json(
      { error: "statistics_invalid_query" },
      { status: 400, headers },
    );
  try {
    const { actorId, report } = await loadStatisticsReport(
      workspaceId,
      readStatisticsFilter(params),
    );
    return NextResponse.json(
      { scope: { actorId, workspaceId }, report },
      { headers },
    );
  } catch (error) {
    const status = statisticsErrorStatus(error);
    return NextResponse.json(
      {
        error:
          status === 500
            ? "statistics_unavailable"
            : status === 401
              ? "statistics_sign_in_required"
              : status === 403
                ? "statistics_access_denied"
                : "statistics_invalid_query",
      },
      { status, headers },
    );
  }
}
