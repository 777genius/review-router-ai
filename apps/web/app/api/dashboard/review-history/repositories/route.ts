import type { NextRequest } from "next/server";
import { loadHistoryRepositories } from "../../../../../src/server/review-history";
import { historyResponse } from "../../../../../src/server/review-history-response";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return historyResponse(() =>
    loadHistoryRepositories(params.get("workspaceId") ?? "", params),
  );
}
