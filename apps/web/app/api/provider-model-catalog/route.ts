import { NextResponse, type NextRequest } from "next/server";
import { getProviderModelCatalog } from "../../../src/server/openrouter-model-catalog";

export const dynamic = "force-dynamic";

// Only the public catalog is returned. Account/profile authorization is a separate seam.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const providerKind = request.nextUrl.searchParams.get("providerKind");
  if (
    providerKind !== "codex" &&
    providerKind !== "claude" &&
    providerKind !== "openrouter"
  ) {
    return NextResponse.json(
      { error: "provider_kind_invalid" },
      { status: 400 },
    );
  }
  const snapshot = await getProviderModelCatalog({
    providerKind,
    forceRefresh: request.nextUrl.searchParams.get("refresh") === "true",
    signal: request.signal,
  });
  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
