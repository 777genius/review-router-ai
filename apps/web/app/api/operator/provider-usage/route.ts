import { NextResponse, type NextRequest } from "next/server";
import { loadOperatorProviderUsage } from "../../../../src/server/provider-usage-operator-report";
import type { UsageFilters } from "../../../../src/server/provider-usage-view-model";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters: UsageFilters = {};
  for (const key of [
    "from",
    "to",
    "route",
    "purpose",
    "bindingId",
    "runId",
    "provider",
    "model",
    "runAfter",
    "after",
  ] as const) {
    const value = params.get(key);
    if (value !== null) Object.assign(filters, { [key]: value });
  }
  try {
    return NextResponse.json(await loadOperatorProviderUsage(filters), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status =
      code === "usage_sign_in_required"
        ? 401
        : code === "usage_access_denied"
          ? 403
          : code === "usage_invalid_report_query"
            ? 400
            : 500;
    return NextResponse.json(
      { error: status === 500 ? "usage_report_unavailable" : code },
      { status, headers: { "cache-control": "private, no-store" } },
    );
  }
}
