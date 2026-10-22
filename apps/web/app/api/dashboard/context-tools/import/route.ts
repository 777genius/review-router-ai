import { z } from "zod";
import {
  contextToolsPublicError,
  importDashboardContextSelection,
} from "../../../../../src/server/context-tools";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const querySchema = z
  .object({
    workspaceId: z.string().min(1).max(256),
    repositoryId: z.string().min(1).max(256),
  })
  .strict();
export async function GET(request: Request): Promise<Response> {
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return Response.json(
      { error: "context_connection_invalid" },
      { status: 400, headers },
    );
  try {
    return Response.json(
      await importDashboardContextSelection(
        query.data.workspaceId,
        query.data.repositoryId,
      ),
      { headers },
    );
  } catch (error) {
    const safe = contextToolsPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  }
}
